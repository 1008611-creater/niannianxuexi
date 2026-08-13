import WorkspaceSidebar from "@/components/sidebar/WorkspaceSidebar";
import AppShell from "@/components/layout/AppShell";
import { CapabilityAccessProvider } from "@/components/access/CapabilityAccessContext";
import CapabilityGate from "@/components/access/CapabilityGate";
import AccountAccessGate from "@/components/access/AccountAccessGate";
import { UnifiedChatProvider } from "@/context/UnifiedChatContext";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CapabilityAccessProvider>
      <UnifiedChatProvider>
        <AppShell sidebar={<WorkspaceSidebar />}>
          <AccountAccessGate>
            <CapabilityGate>{children}</CapabilityGate>
          </AccountAccessGate>
        </AppShell>
      </UnifiedChatProvider>
    </CapabilityAccessProvider>
  );
}
