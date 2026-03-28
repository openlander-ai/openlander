new_css = """  :root {
    /* ── Typography Scale ── */
    --font-size-xs: 0.75rem; /* 12px */
    --font-size-sm: 0.875rem; /* 14px */
    --font-size-base: 1rem; /* 16px */
    --font-size-lg: 1.125rem; /* 18px */
    --font-size-xl: 1.25rem; /* 20px */
    --font-size-2xl: 1.5rem; /* 24px */
    --font-size-3xl: 1.875rem; /* 30px */

    /* ── OpenLander Signature (Light) ── */
    --bg-app: #ffffff;
    --bg-panel: #fafafa;
    --bg-subtle: #f4f4f5;
    --bg-surface: #ffffff;
    --bg-terminal: #000000;
    --color-accent: #09090b; /* black for primary */
    --color-ai: #a855f7; /* purple-500 for AI magic */
    --color-success: #10b981;
    --color-warning: #f59e0b;
    --color-error: #ef4444;
    --text-primary: #09090b;
    --text-secondary: #52525b;
    --text-muted: #a1a1aa;

    /* ── shadcn/ui — Light ── */
    --background: 0 0% 100%;
    --foreground: 240 10% 4%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 4%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 4%;
    --primary: 240 10% 4%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 5% 96%;
    --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 46%;
    --accent: 240 5% 96%;
    --accent-foreground: 240 6% 10%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 240 10% 4%;
    --radius: 0.5rem;
  }

  [data-theme='dark'] {
    /* ── OpenLander Signature (Dark) ── */
    --bg-app: #000000;
    --bg-panel: #0a0a0a;
    --bg-subtle: #171717;
    --bg-surface: #0a0a0a;
    --bg-terminal: #000000;
    --color-accent: #ededed;
    --color-ai: #c084fc; /* purple-400 */
    --color-success: #10b981;
    --color-warning: #f59e0b;
    --color-error: #ef4444;
    --text-primary: #ededed;
    --text-secondary: #a1a1aa;
    --text-muted: #52525b;

    /* ── shadcn/ui — Dark ── */
    --background: 0 0% 0%;
    --foreground: 0 0% 93%;
    --card: 0 0% 4%;
    --card-foreground: 0 0% 93%;
    --popover: 0 0% 4%;
    --popover-foreground: 0 0% 93%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 0%;
    --secondary: 0 0% 12%;
    --secondary-foreground: 0 0% 93%;
    --muted: 0 0% 12%;
    --muted-foreground: 0 0% 64%;
    --accent: 0 0% 12%;
    --accent-foreground: 0 0% 93%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 93%;
    --border: 0 0% 14%;
    --input: 0 0% 14%;
    --ring: 0 0% 83%;
  }
"""

with open("web/src/index.css", "r") as f:
    lines = f.readlines()

new_content = "".join(lines[:9]) + new_css + "".join(lines[531:])

with open("web/src/index.css", "w") as f:
    f.write(new_content)
