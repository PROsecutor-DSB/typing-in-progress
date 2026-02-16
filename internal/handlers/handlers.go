package handlers

import (
	"real-time-forum/internal/chat"
	"real-time-forum/internal/models"
)

type Handler struct {
	Users     *models.UserModel
	Sessions  *models.SessionModel
	Posts     *models.PostModel
	Comments  *models.CommentModel
	Reactions *models.ReactionModel
	Hub       *chat.Hub
}

func NewHandler(users *models.UserModel, sessions *models.SessionModel, posts *models.PostModel, comments *models.CommentModel, reactions *models.ReactionModel, hub *chat.Hub) *Handler {
	return &Handler{
		Users:     users,
		Sessions:  sessions,
		Posts:     posts,
		Comments:  comments,
		Reactions: reactions,
		Hub:       hub,
	}
}
