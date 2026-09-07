import { DoctorNoteForm } from "@/components/health/doctor-note-form";

export const metadata = { title: "New Doctor Visit — Ayus" };

export default function NewDoctorNotePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Record Doctor Visit</h1>
      <DoctorNoteForm />
    </div>
  );
}
