"use client";

const FRIENDS = ["David", "Jeff", "Ernesto", "Nirav"];

type Props = {
  onSelect: (name: string) => void;
  onDismiss: () => void;
};

export default function NamePicker({ onSelect, onDismiss }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="rounded-2xl p-8 max-w-sm w-full mx-4 space-y-6"
        style={{ background: "var(--background)", boxShadow: "0 25px 50px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Who&apos;s visiting?</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Select your name to upload photos and videos
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

        <button
          onClick={onDismiss}
          className="w-full px-4 py-3 rounded-xl text-sm font-medium transition-all hover:scale-105 active:scale-95"
          style={{
            border: "1px solid var(--border)",
            color: "var(--muted)",
            background: "transparent",
          }}
        >
          I&apos;m just checking it out
        </button>
      </div>
    </div>
  );
}
