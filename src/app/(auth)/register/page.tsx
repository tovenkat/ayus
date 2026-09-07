import { PhoneAuthForm } from "@/components/auth/phone-auth-form";

export const metadata = { title: "Create account — Ayus" };

export default function RegisterPage() {
  return <PhoneAuthForm mode="REGISTER" />;
}
