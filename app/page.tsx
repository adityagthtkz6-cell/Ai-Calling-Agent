import { redirect } from "next/navigation";

// Redirect to the SFSBI demo client dashboard by default.
// In production, this would check the session and route to
// the authenticated client's dashboard.
export default function RootPage() {
  redirect("/dashboard/00000000-0000-0000-0000-000000000001");
}
