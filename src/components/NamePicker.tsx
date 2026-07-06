"use client";

import { useState } from "react";

const FRIENDS = ["David", "Alex", "Jordan", "Sam"];

type Props = {
  onSelect: (name: string) => void;
};

export default function NamePicker({ onSelect }: Props) {
  const [customName, setCustomName] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="rounded-2xl p-8 max-w-sm w-full mx-4 space-y-6"
        style={{ background: "var(--background)", boxShadow: "0 25px 50px rgba(0,0,0,0.25)" }}
      >
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Who&apos;s uploading?</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Pick your name so everyone knows whose photos are whose
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {FRIENDS.map((name) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="px-4 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 active:scale-95"
              style={{
                background: "var(--border)",
                color: "var(--foreground)",
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="relative">
          <div
            className="absolute inset-0 flex items-center"
            aria-hidden="true"
          >
            <div className="w-full" style={{ borderTop: "1px solid var(--border)" }} />
          </div>
          <div className="relative flex justify-center">
            <span
              className="px-3 text-xs"
              style={{ background: "var(--background)", color: "var(--muted)" }}
            >
              or type your name
            </span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customName.trim()) onSelect(customName.trim());
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Your name"
            className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "var(--border)",
              color: "var(--foreground)",
            }}
          />
          <button
            type="submit"
            disabled={!customName.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
}
