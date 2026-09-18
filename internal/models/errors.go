package models

import (
	"errors"
	"strings"
)

// Errors the handlers can act on, instead of treating every database failure
// as an internal error.
var (
	ErrDuplicateNickname = errors.New("models: nickname already taken")
	ErrDuplicateEmail    = errors.New("models: email already registered")

	// ErrRelatedRecordMissing means a write referenced a row that does not
	// exist, for example a comment on a post that was never created.
	ErrRelatedRecordMissing = errors.New("models: related record does not exist")
)

// classifyConstraintError turns a driver level constraint violation into one of
// the sentinel errors above. Anything else is passed through untouched.
func classifyConstraintError(err error) error {
	if err == nil {
		return nil
	}

	msg := err.Error()
	switch {
	case strings.Contains(msg, "FOREIGN KEY constraint failed"):
		return ErrRelatedRecordMissing
	case strings.Contains(msg, "users.nickname"):
		return ErrDuplicateNickname
	case strings.Contains(msg, "users.email"):
		return ErrDuplicateEmail
	}
	return err
}
