import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth pane in the workspace toolbar.
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}
