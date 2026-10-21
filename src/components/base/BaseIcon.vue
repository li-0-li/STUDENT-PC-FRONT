<script setup>
/**
 * 基础层组件：图标
 *
 * 用 Lucide（原型 ui-prototype 用的就是 Lucide，见 assets/icons.js），
 * 这样菜单配置里的图标名可以和权威定义 `ui-prototype/assets/shell.js` 的 MENUS **逐字一致**，
 * 不需要在「Lucide 名 → Element Plus 名」之间做人工翻译（那种翻译必然漂移）。
 *
 * 显式登记用到的图标而不是全量引入，保证可 tree-shaking。
 */
import {
  LayoutDashboard, Users, BadgeCheck, Headphones, CalendarDays, BarChart3, ListChecks,
  Sparkles, Database, UploadCloud, Activity, History, Settings, BookOpen, Layers,
  GitBranch, Send, ClipboardList, FlaskConical, FileCheck, Contact, Grid3x3, FolderOpen,
  MonitorPlay, QrCode, MessageCircle, FileText, Bell, UserCheck, ChevronRight,
  Search, Download, RotateCcw, Ticket, Clock, CircleCheck, CircleAlert, Info, LogOut, GraduationCap,
  ThumbsUp, ThumbsDown, AlertTriangle, Target, TrendingUp,
  ArrowLeft, AlertCircle, Settings2, RefreshCw, Plus, Mail, Save, FileCheck2, Radio, ChevronDown,
  Check, ShieldCheck, Presentation, Smartphone, User, UserPlus, Lock,
  ChevronLeft, Sigma, Languages, Code2, Paperclip, Play, X, Upload,
  Eye, Video, Image as ImageIcon, Megaphone, ClockAlert, Wrench, CalendarClock,
  Filter, Pencil, Inbox, MapPin, Camera, Hash, Hand, Scale,
  Timer, Maximize2, Volume2, VolumeX, Phone, CircleHelp, UserX, Mic, MoreHorizontal, Flag, Trash2,
  Pin, BellOff, Quote
} from 'lucide-vue-next'

const ICONS = {
  'layout-dashboard': LayoutDashboard,
  users: Users,
  'badge-check': BadgeCheck,
  headphones: Headphones,
  'calendar-days': CalendarDays,
  'bar-chart-3': BarChart3,
  'list-checks': ListChecks,
  sparkles: Sparkles,
  database: Database,
  'upload-cloud': UploadCloud,
  activity: Activity,
  history: History,
  settings: Settings,
  'book-open': BookOpen,
  layers: Layers,
  'git-branch': GitBranch,
  send: Send,
  'clipboard-list': ClipboardList,
  'folder-open': FolderOpen,
  'flask-conical': FlaskConical,
  'file-check': FileCheck,
  contact: Contact,
  'grid-3x3': Grid3x3,
  'monitor-play': MonitorPlay,
  'qr-code': QrCode,
  'message-circle': MessageCircle,
  'file-text': FileText,
  bell: Bell,
  'user-check': UserCheck,
  'chevron-right': ChevronRight,
  search: Search,
  download: Download,
  'rotate-ccw': RotateCcw,
  ticket: Ticket,
  clock: Clock,
  'circle-check': CircleCheck,
  'circle-alert': CircleAlert,
  'log-out': LogOut,
  'graduation-cap': GraduationCap,
  info: Info,
  // AI 答疑 / AI 学情 / 教师与管理端学情页面用
  // （原型 ui-prototype/pc/student-ai|student-analytics|teacher-*|admin-ai|admin-analytics|ai-workbench.html 用到）
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'alert-triangle': AlertTriangle,
  target: Target,
  'trending-up': TrendingUp,
  'arrow-left': ArrowLeft,
  'alert-circle': AlertCircle,
  'settings-2': Settings2,
  'refresh-cw': RefreshCw,
  plus: Plus,
  mail: Mail,
  save: Save,
  'file-check-2': FileCheck2,
  radio: Radio,
  'chevron-down': ChevronDown,
  // 登录/注册/找回密码页用（原型 ui-prototype/pc/{login,register,forgot-password}.html）
  check: Check,
  'shield-check': ShieldCheck,
  presentation: Presentation,
  smartphone: Smartphone,
  user: User,
  'user-plus': UserPlus,
  lock: Lock,
  // 学生 PC 端页面用（原型 ui-prototype/pc/student-*.html）
  'chevron-left': ChevronLeft,
  sigma: Sigma,
  languages: Languages,
  'code-2': Code2,
  paperclip: Paperclip,
  play: Play,
  x: X,
  upload: Upload,
  eye: Eye,
  video: Video,
  image: ImageIcon,
  megaphone: Megaphone,
  'clock-alert': ClockAlert,
  wrench: Wrench,
  'calendar-clock': CalendarClock,
  filter: Filter,
  pencil: Pencil,
  inbox: Inbox,
  'map-pin': MapPin,
  camera: Camera,
  hash: Hash,
  hand: Hand,
  scale: Scale,
  // 实时课堂 / 客服 / 个人资料用（原型 student-live / support / shell.js 顶栏弹窗）
  timer: Timer,
  'more-horizontal': MoreHorizontal,
  pin: Pin,
  'bell-off': BellOff,
  quote: Quote,
  flag: Flag,
  'trash-2': Trash2,
  'maximize-2': Maximize2,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  phone: Phone,
  'circle-help': CircleHelp,
  'user-x': UserX,
  mic: Mic
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  stroke: { type: [Number, String], default: 2 }
})
</script>

<template>
  <component :is="ICONS[props.name] || Info" :size="props.size" :stroke-width="props.stroke" />
</template>
