import { useEffect, useRef } from "react";
import { ClerkProvider, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import { ProtectedRoute } from "@/components/module-protected-route";
import { useUserSync } from "@/hooks/use-user-sync";

import Home from "@/pages/home";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import DashboardLayout from "@/components/layout";
import DashboardSummary from "@/pages/dashboard/index";
import TasksPage from "@/pages/dashboard/tasks";
import ShortcutsPage from "@/pages/dashboard/shortcuts";
import NewsPage from "@/pages/dashboard/news";
import EmailsPage from "@/pages/dashboard/emails";
import WeatherPage from "@/pages/dashboard/weather";
import FiscalPage from "@/pages/dashboard/fiscal";
import TravelPage from "@/pages/dashboard/travel";
import DueDatesPage from "@/pages/dashboard/due-dates";
import ClientsPage from "@/pages/dashboard/clients";
import SupplierBatchesPage from "@/pages/dashboard/supplier-batches";
import TaxCalendarsPage from "@/pages/dashboard/tax-calendars";
import AdminPage from "@/pages/admin";
import SettingsPage from "@/pages/settings";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const DashboardPage = () => <DashboardLayout><DashboardSummary /></DashboardLayout>;
const Tasks = () => <DashboardLayout><TasksPage /></DashboardLayout>;
const Shortcuts = () => <DashboardLayout><ShortcutsPage /></DashboardLayout>;
const News = () => <DashboardLayout><NewsPage /></DashboardLayout>;
const Emails = () => <DashboardLayout><EmailsPage /></DashboardLayout>;
const Weather = () => <DashboardLayout><WeatherPage /></DashboardLayout>;
const Fiscal = () => <DashboardLayout><FiscalPage /></DashboardLayout>;
const Travel = () => <DashboardLayout><TravelPage /></DashboardLayout>;
const DueDates = () => <DashboardLayout><DueDatesPage /></DashboardLayout>;
const Clients = () => <DashboardLayout><ClientsPage /></DashboardLayout>;
const SupplierBatches = () => <DashboardLayout><SupplierBatchesPage /></DashboardLayout>;
const TaxCalendars = () => <DashboardLayout><TaxCalendarsPage /></DashboardLayout>;
const Admin = () => <DashboardLayout><AdminPage /></DashboardLayout>;
const Settings = () => <DashboardLayout><SettingsPage /></DashboardLayout>;

const RouteDashboard = () => <ProtectedRoute moduleKey="dashboard" component={DashboardPage} />;
const RouteTasks = () => <ProtectedRoute moduleKey="tasks" component={Tasks} />;
const RouteShortcuts = () => <ProtectedRoute moduleKey="shortcuts" component={Shortcuts} />;
const RouteNews = () => <ProtectedRoute moduleKey="news" component={News} />;
const RouteEmails = () => <ProtectedRoute moduleKey="emails" component={Emails} />;
const RouteWeather = () => <ProtectedRoute moduleKey="weather" component={Weather} />;
const RouteFiscal = () => <ProtectedRoute moduleKey="fiscal" component={Fiscal} />;
const RouteTravel = () => <ProtectedRoute moduleKey="travel" component={Travel} />;
const RouteDueDates = () => <ProtectedRoute moduleKey="due-dates" component={DueDates} />;
const RouteClients = () => <ProtectedRoute moduleKey="clients" component={Clients} />;
const RouteSupplierBatches = () => <ProtectedRoute moduleKey="supplier-batches" component={SupplierBatches} />;
const RouteTaxCalendars = () => <ProtectedRoute moduleKey="tax-calendars" component={TaxCalendars} />;
const RouteAdmin = () => <ProtectedRoute moduleKey="admin" component={Admin} />;
const RouteSettings = () => <ProtectedRoute moduleKey="settings" component={Settings} />;

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function UserSyncEffect() {
  useUserSync();
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <UserSyncEffect />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/dashboard" component={RouteDashboard} />
            <Route path="/dashboard/tasks" component={RouteTasks} />
            <Route path="/dashboard/shortcuts" component={RouteShortcuts} />
            <Route path="/dashboard/news" component={RouteNews} />
            <Route path="/dashboard/emails" component={RouteEmails} />
            <Route path="/dashboard/weather" component={RouteWeather} />
            <Route path="/dashboard/fiscal" component={RouteFiscal} />
            <Route path="/dashboard/travel" component={RouteTravel} />
            <Route path="/dashboard/due-dates" component={RouteDueDates} />
            <Route path="/dashboard/clients" component={RouteClients} />
            <Route path="/dashboard/supplier-batches" component={RouteSupplierBatches} />
            <Route path="/dashboard/tax-calendars" component={RouteTaxCalendars} />
            <Route path="/admin" component={RouteAdmin} />
            <Route path="/settings" component={RouteSettings} />
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="dashboard-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
