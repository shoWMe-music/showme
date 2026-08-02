import type { Meta, StoryObj } from "@storybook/react";
import { Toast } from "./Toast";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "./useToast";
import { Button } from "@/components/atoms/Button/Button";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/Toast",
  component: Toast,
  tags: ["autodocs"],
  args: { message: "Archived Nils Frahm", action: { label: "Undo" } },
} satisfies Meta<typeof Toast>;
export default meta;

type Story = StoryObj<typeof meta>;

/* ---- static visual ---- */
export const Default: Story = {};
export const WithIcon: Story = {
  args: {
    icon: <Icon name="check" size={16} />,
    message: "Review link generated — copied to clipboard",
    action: undefined,
  },
};

/* ---- the live system: ToastProvider + useToast ---- */
function ToastPlayground() {
  const toast = useToast();
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Button onClick={() => toast("Archived Nils Frahm", { action: { label: "Undo" } })}>Show toast</Button>
      <Button variant="secondary" onClick={() => toast.success("Settlement sent", { icon: <Icon name="check" size={16} /> })}>Success</Button>
      <Button variant="secondary" onClick={() => toast.error("Couldn't reach the venue", { icon: <Icon name="alert" size={16} /> })}>Error</Button>
      <Button variant="secondary" onClick={() => toast.info("Kiasmos confirmed the date", { icon: <Icon name="bell" size={16} /> })}>Info</Button>
      <Button variant="ghost" onClick={() => {
        const id = toast("Held until finalize", { duration: Infinity, action: { label: "Dismiss", onClick: () => toast.dismiss(id) } });
      }}>Sticky</Button>
    </div>
  );
}

/** Fires real toasts through the provider — stacking, auto-dismiss (hover the
 * stack to pause), and GSAP enter/exit. Position/​max are provider props. */
export const LiveToasts: StoryObj = {
  render: () => (
    <ToastProvider position="bottom-right" max={4}>
      <ToastPlayground />
    </ToastProvider>
  ),
};
