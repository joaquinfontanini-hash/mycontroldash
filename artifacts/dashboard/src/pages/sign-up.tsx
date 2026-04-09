import { SignUp } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth pane in the workspace toolbar.
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}
