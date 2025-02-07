/**
 * @module ko/share/slack/dialog
 */
(function()
{
    
    const api = require("ko/share/slack/api");
    const ss = require("ko/simple-storage").get("slack");
    const log = require("ko/logging").getLogger("slack/dialog");
    const legacy = require("ko/windows").getMain().ko;
    
    var panel;
    var elem = {};
    
    /**
     * Trigger a dialog for a user to fill in fields for posting to slack
     * ```
     * Asks for (* means madatory):
     *   Title (Defaults to `   ` of `filename-snippet`, if changed gets saved to prefs)
     *   Channels* (Saves last select)
     *   Message (No default, not saved)
     *```
     
     * @returns {Object}    postData    object holding the about values
     * ```
     * {
     *      "title":"Posted from Komodo IDE",
     *      "channels":"a,b,c",
     *      "message":"Look what I made!"
     *  }
     * ```
     */
    this.create = function(params, callback)
    {
        this.close();
        
        // Have to open the panel before appending anything
        // XXX this should check for a panel and not recreate it if it already
        // exists.
        panel = require("ko/ui/panel").create({
            anchor: require("ko/windows").getMostRecent().document.documentElement,
            attributes: {
                backdrag: true,
                noautohide: true,
                class: "dialog",
                width: 600
            }
        });
        panel.open();

        panel.addRow(require("ko/ui/label").create("Share "+(title || "")+" on Slack"),
                     {attributes: {flex: 1, align: "center", pack: "center"}});
        
        var title = params.title || ss.storage.title || "";
        elem.titleField = createTitleField(title);
        panel.add(elem.titleField);
        elem.titleField.focus();
        
        elem.availableChannels = createChannelField();
        panel.add(elem.availableChannels);
        
        elem.msgField = createMsgField();
        panel.add(elem.msgField);
        
        // Force placeholder, why timeout? XUL. The answer is XUL. And facepalms.
        // Honestly I don't know why this doesn't work without a timeout, but
        // this is XUL and I don't have time for its nonsense. 
        setTimeout(function() {
            elem.msgField.element.placeholder = "Message (optional)";
        }, 100);
        
        elem.postButton = createPostBtn();
        elem.postButton.onCommand(onPost.bind(this, false, params, callback));
        
        elem.postAndOpenButton = createPostAndOpenBtn();
        elem.postAndOpenButton.onCommand(onPost.bind(this, true, params, callback));
        
        elem.closeButton = createCloseBtn();
        elem.closeButton.onCommand(this.close);
        
        elem.changeTeamButton = createChgTeamBtn();
        elem.changeTeamButton.onCommand(
            function()
            {
                api.deleteKey();
                this.close();
                setTimeout(require("ko/share/slack").share,100, params.content, {title:params.title});
            }.bind(this)
        );
        
        panel.addRow([elem.postButton, elem.postAndOpenButton, elem.changeTeamButton, elem.closeButton],
                     {attributes: {flex: 1, align: "center", pack: "center"}});
        
        // Must retrieve the channels async as they might need to be retrieved
        // through an API call.
        var populateChannels = function (channels)
        {
            var selectedChannel = ss.storage.selectedChannel;
            let keys = Object.keys(channels);
            for(let key of keys)
            {
                elem.availableChannels.addMenuItem(
                    require("ko/ui/menuitem").create(
                        {attributes:{label:key, disabled:true}}
                    ));
                let items = channels[key];
                let prefix = ("Channels" == key) || ("Groups" == key) ? "# ":"@ ";
                for ( let item of items )
                {
                    // Make sure we get the ID, not just the name
                    let opts = {attributes:{label:prefix + item.name, value:item.id}};
                    let listitem = require("ko/ui/menuitem").create(opts);
                    
                    if(item == selectedChannel)
                    {
                        listitem.$element.attr("selected", "true");
                    }
                    
                    elem.availableChannels.addMenuItem(listitem);
                }
            }
            
            elem.availableChannels.enable();
            elem.postButton.enable();
            elem.postAndOpenButton.enable();
            // Not 100% sure why but some times when this runs the panel will
            // be moved to the background behind the main window. Opening and
            // closing it brings it back to the foreground.
            panel.close();
            panel.open();
        };
        api.getChannels(populateChannels);
    };
    
    this.close = function() 
    {
        if ( ! panel)
            return;
        
        panel.close();
        panel.element.remove();
        panel = null;
    };
    
    function onPost(openInBrowser, params, callback)
    {
        params.title = elem.titleField.value();
        params.initial_comment = elem.msgField.value();
        params.openInBrowser = openInBrowser;
        
        var channel = elem.availableChannels.value();
        
        if ( ! channel)
        {
            require("notify/notify").interact("You must choose at least one channel", "slack", {priority: "warn"});
            return;
        }
        
        ss.storage.selectedChannel = channel;
        params.channels = channel;
        var disabled = [];
        for (let k in elem)
        {
            if ("disable" in elem[k] && elem[k].attributes.id != "cancel")
            {
                elem[k].disable();
                disabled.push(elem[k]);
            }
        }
        
        api.post(params, function(code, respText)
        {
            for (let elem of disabled)
                elem.enable();
                
            onPostComplete(params, code, respText, callback);
        }.bind(this));
    }
    
    function onPostComplete(params, code, respText, callback)
    {
        /** Write a proper callback that handles results from the API using
         * notify.  See errors section for API function:
         *   https://api.slack.com/methods/files.upload
         */
        var respJSON;
        try
        {
            respJSON = JSON.parse(respText);
        } catch(e)
        {
            log.error("Could not parse response from server: " + e);
            callback(false);
            return;
        }
        
        if( respJSON.ok )
        {
            var file = respJSON.file;
            var url = file.permalink;
            
            if (params.openInBrowser)
            {
                legacy.browse.openUrlInDefaultBrowser(url);
            }
            
            log.debug("code: "+code+"\nResponse: "+respText);
            callback(true, url);
            require("ko/share/slack/dialog").close();
        }
        else
        {
            log.warn("Slack share failed: \n" + respText);
            callback(false, null, code, respText);
        }
    }
    
    // Title text field
    function createTitleField(title)
    {
        var options = { attributes:
        {
            value: title,
            placeholder: "Title",
            col: 120,
            flex: 1
        }};
        return require("ko/ui/textbox").create(options);
    }

    // Channel selection list        
    function createChannelField()
    {
        var options = { attributes:
            {
                label: "Select a Channel",
                disabled: "true"
            }
        };
        var availableChannels = require("ko/ui/menulist").create(options);
        availableChannels.disable();
        return availableChannels;
    }
    
    // Message Text field
    function createMsgField() {
        var options = {
            attributes:
            {
                multiline: true,
                rows: 3
            }
        };
        return require("ko/ui/textbox").create(options);
    }

    // Post button
    function createPostBtn()
    {
       return require("ko/ui/button").create({attributes:{label:"Share on Slack",disabled:true}});
    }
    
    // Post button
    function createPostAndOpenBtn()
    {
       return require("ko/ui/button").create({attributes:{label:"Share & Open Browser",disabled:true}});
    }
    
    // Close Button
    function createCloseBtn()
    {
        return require("ko/ui/button").create({attributes:{ id: "cancel", label:"Cancel"}});
    }
    
    // Change Teams
    function createChgTeamBtn(params)
    {
        return require("ko/ui/button").create({attributes:{ id: "changeTeam", label:"Change Team"}});
    }
    
}).apply(module.exports);
