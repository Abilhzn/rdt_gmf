export interface Comment {
  id: number;
  parent_comment_id: number | null;
  author_user_id: string;
  author_display_name: string;
  body: string;
  created_at: string;
}
