import UtilitySidebar from "@/components/sidebar/UtilitySidebar";
import AppShell from "@/components/layout/AppShell";
import { CapabilityAccessProvider } from "@/components/access/CapabilityAccessContext";
import CapabilityGate from "@/components/access/CapabilityGate";
import AccountAccessGate from "@/components/access/AccountAccessGate";

export default function UtilityLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CapabilityAccessProvider>
        <AppShell sidebar={<UtilitySidebar />}>
          <AccountAccessGate>
            <CapabilityGate>{children}</CapabilityGate>
          </AccountAccessGate>
        </AppShell>
    </CapabilityAccessProvider>
  );
}
