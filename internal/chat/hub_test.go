package chat

import (
	"encoding/json"
	"testing"
	"time"
)

func newTestClient(hub *Hub, userID int, nickname string) *Client {
	return &Client{
		Hub:      hub,
		Send:     make(chan []byte, 8),
		UserID:   userID,
		Nickname: nickname,
	}
}

// waitFor drains a client's channel until a frame of the given type arrives.
func waitFor(t *testing.T, client *Client, msgType string) map[string]any {
	t.Helper()
	return waitForMatch(t, client, msgType, func(map[string]any) bool { return true })
}

// waitForStatus waits for the presence frame of one particular user; the hub
// also tells a newcomer about itself, which is not what these tests assert on.
func waitForStatus(t *testing.T, client *Client, userID int, online bool) map[string]any {
	t.Helper()
	return waitForMatch(t, client, "status", func(frame map[string]any) bool {
		return frame["user_id"] == float64(userID) && frame["online"] == online
	})
}

func waitForMatch(t *testing.T, client *Client, msgType string, matches func(map[string]any) bool) map[string]any {
	t.Helper()

	deadline := time.After(time.Second)
	for {
		select {
		case raw, ok := <-client.Send:
			if !ok {
				t.Fatalf("client %d was disconnected while waiting for %q", client.UserID, msgType)
			}
			var frame map[string]any
			if err := json.Unmarshal(raw, &frame); err != nil {
				t.Fatalf("invalid frame: %v", err)
			}
			if frame["type"] == msgType && matches(frame) {
				return frame
			}
		case <-deadline:
			t.Fatalf("client %d never received a matching %q frame", client.UserID, msgType)
		}
	}
}

func expectNothing(t *testing.T, client *Client) {
	t.Helper()

	select {
	case raw := <-client.Send:
		t.Fatalf("client %d received unexpected frame: %s", client.UserID, raw)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestHubAnnouncesPresence(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	alice := newTestClient(hub, 1, "alice")
	hub.Register <- alice

	bob := newTestClient(hub, 2, "bob")
	hub.Register <- bob

	// Alice learns that bob arrived
	waitForStatus(t, alice, 2, true)

	// Bob learns that alice was already here
	waitForStatus(t, bob, 1, true)

	hub.Unregister <- bob
	waitForStatus(t, alice, 2, false)
}

// A user connected from two devices stays online until the last one leaves.
func TestHubKeepsUserOnlineWhileAnyDeviceRemains(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	alice := newTestClient(hub, 1, "alice")
	hub.Register <- alice

	phone := newTestClient(hub, 2, "bob")
	laptop := newTestClient(hub, 2, "bob")
	hub.Register <- phone
	hub.Register <- laptop

	waitForStatus(t, alice, 2, true) // bob online
	drain(alice)

	hub.Unregister <- phone
	expectNothing(t, alice) // still online on the laptop

	hub.Unregister <- laptop
	waitForStatus(t, alice, 2, false)
}

func TestHubRoutesMessages(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	alice := newTestClient(hub, 1, "alice")
	bob := newTestClient(hub, 2, "bob")
	carol := newTestClient(hub, 3, "carol")
	for _, c := range []*Client{alice, bob, carol} {
		hub.Register <- c
	}
	drain(alice, bob, carol)

	t.Run("a private message reaches both participants only", func(t *testing.T) {
		hub.Broadcast <- []byte(`{"type":"message","sender_id":1,"receiver_id":2,"content":"hi"}`)
		waitFor(t, alice, "message")
		waitFor(t, bob, "message")
		expectNothing(t, carol)
	})

	t.Run("a typing event never returns to the sender", func(t *testing.T) {
		hub.Broadcast <- []byte(`{"type":"typing","sender_id":1,"receiver_id":2,"nickname":"alice","typing":true}`)
		waitFor(t, bob, "typing")
		expectNothing(t, alice)
		expectNothing(t, carol)
	})

	t.Run("a reaction is public", func(t *testing.T) {
		hub.Broadcast <- []byte(`{"type":"post_reaction","content_id":1,"like_count":1}`)
		waitFor(t, alice, "post_reaction")
		waitFor(t, bob, "post_reaction")
		waitFor(t, carol, "post_reaction")
	})

	t.Run("a malformed frame is ignored", func(t *testing.T) {
		hub.Broadcast <- []byte(`{not json`)
		expectNothing(t, alice)
	})
}

// A client that stops reading must be dropped once, never closed twice.
func TestHubDropsSaturatedClientExactlyOnce(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	slow := &Client{Hub: hub, Send: make(chan []byte), UserID: 2} // unbuffered: always full
	fast := newTestClient(hub, 3, "fast")
	hub.Register <- slow
	hub.Register <- fast
	drain(fast)

	// Several broadcasts in a row would panic if Send were closed twice
	for i := 0; i < 5; i++ {
		hub.Broadcast <- []byte(`{"type":"post_reaction","content_id":1}`)
	}

	waitFor(t, fast, "post_reaction")

	hub.Mu.Lock()
	_, stillListed := hub.Clients[slow]
	hub.Mu.Unlock()
	if stillListed {
		t.Error("the saturated client is still registered")
	}

	// Unregistering an already dropped client must be harmless
	hub.Unregister <- slow
	hub.Broadcast <- []byte(`{"type":"post_reaction","content_id":2}`)
	waitFor(t, fast, "post_reaction")
}

func TestHubCloseAll(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	alice := newTestClient(hub, 1, "alice")
	hub.Register <- alice
	drain(alice)

	hub.CloseAll()

	select {
	case _, ok := <-alice.Send:
		if ok {
			t.Error("expected the channel to be closed")
		}
	case <-time.After(time.Second):
		t.Error("CloseAll did not disconnect the client")
	}
}

func drain(clients ...*Client) {
	for _, client := range clients {
		for {
			select {
			case <-client.Send:
			case <-time.After(150 * time.Millisecond):
				goto next
			}
		}
	next:
	}
}
