/**
 * Minimal fixture that renders a Combobox with 10+ items inside a Dialog,
 * served at /__test__/combobox by Vite (see vite plugin in e2e/vite-plugin.ts).
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Combobox, ComboboxOption } from "../src/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../src/components/ui/dialog";
import { Button } from "../src/components/ui/button";
import "../src/index.css";

const ITEMS = Array.from({ length: 12 }, (_, i) => ({
  id: `item-${i}`,
  name: `Artist ${String.fromCharCode(65 + i)}`,
}));

function TestCombobox() {
  const [value, setValue] = useState("");
  const filtered = ITEMS.filter((item) =>
    item.name.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <div style={{ padding: 40 }}>
      <h2>Combobox in Dialog — Scroll Test</h2>

      <Dialog>
        <DialogTrigger asChild>
          <Button data-testid="open-dialog">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick an artist</DialogTitle>
          </DialogHeader>

          <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
            Performer
          </label>
          <Combobox
            value={value}
            onValueChange={setValue}
            placeholder="Search performers…"
          >
            {filtered.map((item) => (
              <ComboboxOption
                key={item.id}
                selected={item.name === value}
                onSelect={() => setValue(item.name)}
              >
                {item.name}
              </ComboboxOption>
            ))}
          </Combobox>
        </DialogContent>
      </Dialog>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TestCombobox />);
