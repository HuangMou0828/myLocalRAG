import type { LucideIcon } from 'lucide-vue-next'
import {
  Bell,
  Bug,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Database,
  Download,
  FileText,
  FolderOpen,
  Info,
  Link2,
  ListFilter,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Upload,
  UserRound,
  Wrench,
} from 'lucide-vue-next'

export const IconBug = Bug
export const IconCheck = Check
export const IconCopy = Copy
export const IconFolderOpen = FolderOpen
export const IconLink2 = Link2
export const IconPanelLeftClose = PanelLeftClose
export const IconPanelLeftOpen = PanelLeftOpen
export const IconRefreshCw = RefreshCw
export const IconSettings2 = Settings2

export const IconBell = Bell
export const IconCalendarDays = CalendarDays
export const IconClock3 = Clock3
export const IconDatabase = Database
export const IconDownload = Download
export const IconFileText = FileText
export const IconInfo = Info
export const IconListFilter = ListFilter
export const IconSearch = Search
export const IconShieldCheck = ShieldCheck
export const IconSlidersHorizontal = SlidersHorizontal
export const IconSparkles = Sparkles
export const IconTriangleAlert = TriangleAlert
export const IconUpload = Upload
export const IconUserRound = UserRound
export const IconWrench = Wrench

export const appIconCatalog = [
  { id: 'IconBug', label: 'Bug', component: IconBug },
  { id: 'IconCheck', label: 'Check', component: IconCheck },
  { id: 'IconCopy', label: 'Copy', component: IconCopy },
  { id: 'IconFolderOpen', label: 'FolderOpen', component: IconFolderOpen },
  { id: 'IconLink2', label: 'Link2', component: IconLink2 },
  { id: 'IconPanelLeftClose', label: 'PanelLeftClose', component: IconPanelLeftClose },
  { id: 'IconPanelLeftOpen', label: 'PanelLeftOpen', component: IconPanelLeftOpen },
  { id: 'IconRefreshCw', label: 'RefreshCw', component: IconRefreshCw },
  { id: 'IconSettings2', label: 'Settings2', component: IconSettings2 },
  { id: 'IconBell', label: 'Bell', component: IconBell },
  { id: 'IconCalendarDays', label: 'CalendarDays', component: IconCalendarDays },
  { id: 'IconClock3', label: 'Clock3', component: IconClock3 },
  { id: 'IconDatabase', label: 'Database', component: IconDatabase },
  { id: 'IconDownload', label: 'Download', component: IconDownload },
  { id: 'IconFileText', label: 'FileText', component: IconFileText },
  { id: 'IconInfo', label: 'Info', component: IconInfo },
  { id: 'IconListFilter', label: 'ListFilter', component: IconListFilter },
  { id: 'IconSearch', label: 'Search', component: IconSearch },
  { id: 'IconShieldCheck', label: 'ShieldCheck', component: IconShieldCheck },
  { id: 'IconSlidersHorizontal', label: 'SlidersHorizontal', component: IconSlidersHorizontal },
  { id: 'IconSparkles', label: 'Sparkles', component: IconSparkles },
  { id: 'IconTriangleAlert', label: 'TriangleAlert', component: IconTriangleAlert },
  { id: 'IconUpload', label: 'Upload', component: IconUpload },
  { id: 'IconUserRound', label: 'UserRound', component: IconUserRound },
  { id: 'IconWrench', label: 'Wrench', component: IconWrench },
] as const satisfies ReadonlyArray<{ id: string; label: string; component: LucideIcon }>

export type AppIconCatalogItem = (typeof appIconCatalog)[number]
export type AppIconId = AppIconCatalogItem['id']

export const appIconUsageMap: Record<AppIconId, string[]> = {
  IconBug: ['src/features/overlays/AppOverlayModals.vue'],
  IconCheck: ['src/features/component-library/ComponentLibraryPanel.vue'],
  IconCopy: ['src/features/component-library/ComponentLibraryPanel.vue', 'src/features/overlays/AppOverlayModals.vue'],
  IconFolderOpen: ['src/features/app/components/AppToolbar.vue'],
  IconLink2: ['src/features/overlays/AppOverlayModals.vue'],
  IconPanelLeftClose: ['src/features/app/components/AppSidebar.vue'],
  IconPanelLeftOpen: ['src/features/app/components/AppSidebar.vue'],
  IconRefreshCw: ['src/features/app/components/AppToolbar.vue'],
  IconSettings2: ['src/features/app/components/AppToolbar.vue'],
  IconBell: [],
  IconCalendarDays: [],
  IconClock3: [],
  IconDatabase: ['src/features/app/components/AppToolbar.vue'],
  IconDownload: [],
  IconFileText: [],
  IconInfo: [],
  IconListFilter: [],
  IconSearch: [],
  IconShieldCheck: [],
  IconSlidersHorizontal: [],
  IconSparkles: [],
  IconTriangleAlert: [],
  IconUpload: [],
  IconUserRound: [],
  IconWrench: [],
}
