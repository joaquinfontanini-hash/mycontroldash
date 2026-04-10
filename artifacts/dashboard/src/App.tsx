import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";

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

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

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

function ProtectedRoute({ component: Component }: { component: any }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
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
        <TooltipProvider>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/dashboard" component={() => <ProtectedRoute component={() => <DashboardLayout><DashboardSummary /></DashboardLayout>} />} />
            <Route path="/dashboard/tasks" component={() => <ProtectedRoute component={() => <DashboardLayout><TasksPage /></DashboardLayout>} />} />
            <Route path="/dashboard/shortcuts" component={() => <ProtectedRoute component={() => <DashboardLayout><ShortcutsPage /></DashboardLayout>} />} />
            <Route path="/dashboard/news" component={() => <ProtectedRoute component={() => <DashboardLayout><NewsPage /></DashboardLayout>} />} />
            <Route path="/dashboard/emails" component={() => <ProtectedRoute component={() => <DashboardLayout><EmailsPage /></DashboardLayout>} />} />
            <Route path="/dashboard/weather" component={() => <ProtectedRoute component={() => <DashboardLayout><WeatherPage /></DashboardLayout>} />} />
            <Route path="/dashboard/fiscal" component={() => <ProtectedRoute component={() => <DashboardLayout><FiscalPage /></DashboardLayout>} />} />
            <Route path="/dashboard/travel" component={() => <ProtectedRoute component={() => <DashboardLayout><TravelPage /></DashboardLayout>} />} />
            <Route path="/dashboard/due-dates" component={() => <ProtectedRoute component={() => <DashboardLayout><DueDatesPage /></DashboardLayout>} />} />
            <Route path="/dashboard/clients" component={() => <ProtectedRoute component={() => <DashboardLayout><ClientsPage /></DashboardLayout>} />} />
            <Route path="/dashboard/supplier-batches" component={() => <ProtectedRoute component={() => <DashboardLayout><SupplierBatchesPage /></DashboardLayout>} />} />
            <Route path="/dashboard/tax-calendars" component={() => <ProtectedRoute component={() => <DashboardLayout><TaxCalendarsPage /></DashboardLayout>} />} />
            <Route path="/admin" component={() => <ProtectedRoute component={() => <DashboardLayout><AdminPage /></DashboardLayout>} />} />
            <Route path="/settings" component={() => <ProtectedRoute component={() => <DashboardLayout><SettingsPage /></DashboardLayout>} />} />
            
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
