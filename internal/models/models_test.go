package models_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"real-time-forum/internal/database"
	"real-time-forum/internal/models"
)

func newUsers(t *testing.T) (*models.UserModel, *models.MessageModel) {
	t.Helper()

	db, err := database.InitDatabase(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("InitDatabase: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	return &models.UserModel{DB: db}, &models.MessageModel{DB: db}
}

func createUser(t *testing.T, users *models.UserModel, nickname, email string) *models.User {
	t.Helper()

	user := &models.User{
		Nickname: nickname, Age: 30, Gender: "other",
		FirstName: "First", LastName: "Last", Email: email, Password: "hashed",
	}
	if err := users.Create(user); err != nil {
		t.Fatalf("Create(%s): %v", nickname, err)
	}

	stored, err := users.GetByNickname(nickname)
	if err != nil {
		t.Fatalf("GetByNickname(%s): %v", nickname, err)
	}
	return stored
}

func TestCreateUserRejectsDuplicates(t *testing.T) {
	users, _ := newUsers(t)
	createUser(t, users, "alice", "alice@example.com")

	err := users.Create(&models.User{Nickname: "alice", Age: 30, Gender: "other", FirstName: "A", LastName: "B", Email: "other@example.com", Password: "x"})
	if !errors.Is(err, models.ErrDuplicateNickname) {
		t.Errorf("duplicate nickname: got %v, want ErrDuplicateNickname", err)
	}

	err = users.Create(&models.User{Nickname: "alice2", Age: 30, Gender: "other", FirstName: "A", LastName: "B", Email: "alice@example.com", Password: "x"})
	if !errors.Is(err, models.ErrDuplicateEmail) {
		t.Errorf("duplicate email: got %v, want ErrDuplicateEmail", err)
	}
}

func TestGetByEmailIsCaseInsensitive(t *testing.T) {
	users, _ := newUsers(t)
	createUser(t, users, "alice", "alice@example.com")

	if _, err := users.GetByEmail("ALICE@Example.com"); err != nil {
		t.Errorf("GetByEmail with different case: %v", err)
	}
}

// The audit asks for a contact list ordered like a chat application.
func TestListChatContactsOrdersByLastMessage(t *testing.T) {
	users, messages := newUsers(t)
	alice := createUser(t, users, "alice", "alice@example.com")
	bob := createUser(t, users, "bob", "bob@example.com")
	carol := createUser(t, users, "carol", "carol@example.com")

	contacts, err := users.ListChatContacts(alice.ID)
	if err != nil {
		t.Fatalf("ListChatContacts: %v", err)
	}
	if len(contacts) != 2 {
		t.Fatalf("got %d contacts, want 2 (the caller must not be listed)", len(contacts))
	}
	if contacts[0].Nickname != "bob" || contacts[1].Nickname != "carol" {
		t.Errorf("without messages the order must be alphabetical, got %s, %s", contacts[0].Nickname, contacts[1].Nickname)
	}

	// Carol is alphabetically last but writes the most recent message
	if err := messages.Save(&models.Message{SenderID: alice.ID, ReceiverID: bob.ID, Content: "hi bob"}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	if err := messages.Save(&models.Message{SenderID: carol.ID, ReceiverID: alice.ID, Content: "hi alice"}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	contacts, err = users.ListChatContacts(alice.ID)
	if err != nil {
		t.Fatalf("ListChatContacts: %v", err)
	}
	if contacts[0].Nickname != "carol" {
		t.Errorf("the newest conversation must come first, got %s", contacts[0].Nickname)
	}
}

func TestMessageHistoryPaginates(t *testing.T) {
	users, messages := newUsers(t)
	alice := createUser(t, users, "alice", "alice@example.com")
	bob := createUser(t, users, "bob", "bob@example.com")

	for i := 0; i < 25; i++ {
		if err := messages.Save(&models.Message{SenderID: alice.ID, ReceiverID: bob.ID, Content: string(rune('a' + i))}); err != nil {
			t.Fatalf("Save: %v", err)
		}
		time.Sleep(time.Millisecond)
	}

	first, err := messages.GetHistory(bob.ID, alice.ID, 10, 0)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(first) != 10 {
		t.Fatalf("first page: got %d messages, want 10", len(first))
	}

	second, err := messages.GetHistory(bob.ID, alice.ID, 10, 10)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(second) != 10 {
		t.Fatalf("second page: got %d messages, want 10", len(second))
	}
	if first[0].ID == second[0].ID {
		t.Error("the second page repeats the first one")
	}
	if !first[0].CreatedAt.After(first[len(first)-1].CreatedAt) {
		t.Error("history must start with the newest message")
	}
}

// A conversation must never leak into somebody else's history.
func TestMessageHistoryIsPrivate(t *testing.T) {
	users, messages := newUsers(t)
	alice := createUser(t, users, "alice", "alice@example.com")
	bob := createUser(t, users, "bob", "bob@example.com")
	carol := createUser(t, users, "carol", "carol@example.com")

	if err := messages.Save(&models.Message{SenderID: alice.ID, ReceiverID: bob.ID, Content: "secret"}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	history, err := messages.GetHistory(carol.ID, alice.ID, 10, 0)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 0 {
		t.Errorf("carol can read %d messages of a conversation she is not part of", len(history))
	}
}

// Foreign keys must hold on every pooled connection, not just the first one.
func TestForeignKeysAreEnforcedConcurrently(t *testing.T) {
	users, messages := newUsers(t)
	alice := createUser(t, users, "alice", "alice@example.com")

	errs := make(chan error, 25)
	for i := 0; i < 25; i++ {
		go func() {
			errs <- messages.Save(&models.Message{SenderID: alice.ID, ReceiverID: 99999, Content: "ghost"})
		}()
	}

	for i := 0; i < 25; i++ {
		if err := <-errs; err == nil {
			t.Fatal("a message addressed to a non-existent user was stored")
		}
	}
}

// A foreign key violation must be reported as a missing relation, so that the
// handlers can answer 400 instead of 500.
func TestMissingRelationIsClassified(t *testing.T) {
	users, messages := newUsers(t)
	alice := createUser(t, users, "alice", "alice@example.com")

	err := messages.Save(&models.Message{SenderID: alice.ID, ReceiverID: 99999, Content: "ghost"})
	if !errors.Is(err, models.ErrRelatedRecordMissing) {
		t.Errorf("got %v, want ErrRelatedRecordMissing", err)
	}

	comments := &models.CommentModel{DB: users.DB}
	err = comments.Create(&models.Comment{PostID: 99999, UserID: alice.ID, Content: "orphan"})
	if !errors.Is(err, models.ErrRelatedRecordMissing) {
		t.Errorf("got %v, want ErrRelatedRecordMissing", err)
	}

	reactions := &models.ReactionModel{DB: users.DB}
	if _, err = reactions.TogglePostReaction(alice.ID, 99999, "like"); !errors.Is(err, models.ErrRelatedRecordMissing) {
		t.Errorf("got %v, want ErrRelatedRecordMissing", err)
	}
}
