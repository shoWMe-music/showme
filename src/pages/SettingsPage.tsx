import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import AppLayout from "@/components/AppLayout";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Settings2, Shield, Plug, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { GeneralTab } from "@/components/settings/GeneralTab";


import { SecurityTab } from "@/components/settings/SecurityTab";

import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { BillingTab } from "@/components/settings/BillingTab";

type SettingsTab = "general" | "security" | "integrations" | "billing";

const validTabs = new Set<SettingsTab>(["general", "security", "integrations", "billing"]);

const settingsTabs: { id: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "General", icon: Settings2 },


  { id: "security", label: "Security & Privacy", icon: Shield },

  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "billing", label: "Subscription & Billing", icon: CreditCard },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const initialTab = window.location.hash.slice(1) as SettingsTab;
  const [activeTab, setActiveTab] = useState<SettingsTab>(validTabs.has(initialTab) ? initialTab : "general");

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate({ to: "/landing", replace: true });
    } catch {
      toast({ title: "Could not sign out", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-muted-foreground">Manage your account and platform preferences</p>
        </div>

        <div className="mb-6 flex gap-1 border-b overflow-x-auto">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
                activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="max-w-2xl">
          {activeTab === "general" && <GeneralTab />}


          {activeTab === "security" && <SecurityTab onSignOut={handleSignOut} />}

          {activeTab === "integrations" && <IntegrationsTab />}
          {activeTab === "billing" && <BillingTab />}
        </div>
      </div>
    </AppLayout>
  );
}
