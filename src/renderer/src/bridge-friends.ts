/// 好友 / Starcloud ID 相关类型（桥接 friends.* / starcloud.*）。
/// 字段与 C# FriendsService 的 JSON 契约一一对应 —— 那边是 snake_case
/// （模型的 JsonPropertyName 优先于桥接的 CamelCase 策略），所以这里保持下划线。
/// `WhenWritingNull` 会省略 null 字段，可空字段一律写成可选属性。

/** 用户在好友语境下的公开资料（PublicProfile）。 */
export interface ScPublicProfile {
  user_id: string
  id: string
  display_name: string
  avatar_url?: string
}

/** 好友列表项（unread = 对方发来的未读消息数）。 */
export interface ScFriend extends ScPublicProfile {
  since: string
  unread: number
}

/** 好友申请（incoming 的 user = 申请人，outgoing 的 user = 被申请人）。 */
export interface ScFriendRequestView {
  request_id: string
  message?: string
  created_at: string
  user: ScPublicProfile
}

export interface ScFriendRequests {
  incoming: ScFriendRequestView[]
  outgoing: ScFriendRequestView[]
}

/** relation: friend / outgoing / incoming / none */
export interface ScFriendSearchResult extends ScPublicProfile {
  relation: string
}

/** 联机邀请（connectionText 由桥接算好：房间码或 address:port）。 */
export interface ScFriendInvite {
  invite_id: string
  from_user_id: string
  to_user_id: string
  address?: string
  port?: number
  room_code?: string
  message?: string
  status: string
  created_at: string
  expires_at: string
  responded_at?: string
  user: ScPublicProfile
  connectionText: string
}

export interface ScFriendInvites {
  incoming: ScFriendInvite[]
  outgoing: ScFriendInvite[]
}

/** 一条好友私聊消息。 */
export interface ScFriendMessage {
  id: number
  from_user_id: string
  to_user_id: string
  content: string
  created_at: string
  read_at?: string
}

/** 聊天记录一页（按 id 向前翻页）。 */
export interface ScConversationPage {
  items: ScFriendMessage[]
  has_more: boolean
  next_before_id?: number
}

/** starcloud.state / starcloud.login 的返回体（不含 api_key，密钥留在桥接进程）。 */
export interface ScSession {
  loggedIn: boolean
  userId?: string
  displayName?: string
  channel?: string
  loginAt?: string
}
