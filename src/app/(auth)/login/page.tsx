import { Suspense } from "react";
import { PhoneAuthForm } from "@/components/auth/phone-auth-form";

export const metadata = { title: "Sign in — Ayus" };

export default function LoginPage() {
  return (
    <Suspense>
      <PhoneAuthForm mode="LOGIN" />
    </Suspense>
  );
}
