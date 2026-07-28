export interface Notification {
  id: number;
  comment_id: number;
  body: string;
  author_user_id: string;
  author_display_name: string;
  dinas_inisiasi: string;
  dinas_target: string;
  created_at: string;
  read_at: string | null;
}
