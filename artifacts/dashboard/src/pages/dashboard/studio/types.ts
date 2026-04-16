// Shared types for Dashboard Studio

export interface Dashboard {
  id: number;
  ownerUserId: number;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  category?: string | null;
  status: string;
  isFavorite?: boolean;
  isSystem?: boolean;
  sourceType?: string | null;
  version: number;
  refreshIntervalSeconds?: number | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _access?: "owner" | "admin" | "edit" | "view";
}

export interface DashboardWidget {
  id: number;
  dashboardId: number;
  type: string;
  title: string;
  subtitle?: string | null;
  dataSourceKey?: string | null;
  configJson?: Record<string, unknown>;
  visible?: boolean;
  orderIndex: number;
  lastDataSnapshotJson?: unknown;
  lastDataSnapshotAt?: string | null;
  snapshotExpiresAt?: string | null;
  snapshotStatus?: string | null;
  snapshotVersion?: number;
}

export interface LayoutItem {
  widgetId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  id: number;
  dashboardId: number;
  breakpoint: "desktop" | "tablet" | "mobile";
  layoutJson: LayoutItem[];
  version: number;
}

export interface DashboardFull extends Dashboard {
  widgets: DashboardWidget[];
  filters: DashboardFilter[];
  layouts: DashboardLayout[];
}

export interface DashboardFilter {
  id: number;
  dashboardId: number;
  key: string;
  label: string;
  type: string;
  defaultValueJson?: unknown;
  orderIndex: number;
}

export interface WidgetData {
  data: unknown;
  fromSnapshot: boolean;
  snapshotAt?: string;
  snapshotStatus?: string;
}

export type Breakpoint = "desktop" | "tablet" | "mobile";
