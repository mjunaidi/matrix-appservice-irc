/*
 * Tests IRC connections are managed correctly.
 */
"use strict";
var test = require("../util/test");
var q = require("q");

// set up integration testing mocks
var env = test.mkEnv();

// set up test config
var appConfig = env.appConfig;
var roomMapping = appConfig.roomMapping;

describe("IRC connections", function() {
    var testUser = {
        id: "@alice:hs",
        nick: "M-alice"
    };

    beforeEach(function(done) {
        test.beforeEach(this, env);

        // make the bot automatically connect and join the mapped channel
        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        // we're not interested in the joins, so autojoin them.
        env.ircMock._autoJoinChannels(
            roomMapping.server, testUser.nick, roomMapping.channel
        );

        // do the init
        test.initEnv(env).done(function() {
            done();
        });
    });

    it("should use the matrix user's display name if they have one", 
    function(done) {
        var displayName = "Some_Name";
        var nickForDisplayName = "M-Some_Name";

        // not interested in join calls
        env.ircMock._autoJoinChannels(
            roomMapping.server, nickForDisplayName, roomMapping.channel
        );

        // listen for the display name nick and let it connect
        var gotConnectCall = false;
        env.ircMock._whenClient(roomMapping.server, nickForDisplayName, "connect", 
        function(client, cb) {
            gotConnectCall = true;
            client._invokeCallback(cb);
        });

        // also listen for the normal nick so we can whine more coherently
        // rather than just time out the test.
        env.ircMock._whenClient(roomMapping.server, testUser.nick, "connect", 
        function(client, cb) {
            console.error("Wrong nick connected: %s", testUser.nick);
            client._invokeCallback(cb);
        });

        // mock a response for the state event.
        env.clientMock._client().getStateEvent.andCallFake(function() {
            return q({
                displayname: displayName
            });
        });

        var gotSayCall = false;
        env.ircMock._whenClient(roomMapping.server, nickForDisplayName, "say", 
        function(client, channel, text) {
            expect(client.nick).toEqual(nickForDisplayName);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            gotSayCall = true;
        });

        // send a message to kick start the AS
        env.mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "A message",
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        }).done(function() {
            expect(gotConnectCall).toBe(
                true, nickForDisplayName+" failed to connect to IRC."
            );
            expect(gotSayCall).toBe(true, "Didn't get say");
            done();
        });
    });

    it("should be made once per client, regardless of how many messages are "+
    "to be sent to IRC", function(done) {
        var connectCount = 0;

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "connect", 
        function(client, cb) {
            connectCount += 1;
            // add an artificially long delay to make sure it isn't connecting
            // twice
            setTimeout(function() {
                client._invokeCallback(cb);
            }, 500);
        });

        var promises = [];

        promises.push(env.mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "A message",
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        }));

        promises.push(env.mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "Another message",
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        }));

        q.all(promises).done(function() {
            expect(connectCount).toBe(1);
            done();
        });
    });
});