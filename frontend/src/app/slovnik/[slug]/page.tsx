import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { glossaryTerms, getGlossaryTerm } from "@/lib/glossary";

export function generateStaticParams() {
  return glossaryTerms.map((term) => ({ slug: term.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const term = getGlossaryTerm(params.slug);
  if (!term) {
    return {
      title: "Pojem nenájdený | Verifa.sk",
    };
  }
  return {
    title: `${term.title} — vysvetlenie | Verifa.sk`,
    description: term.shortDescription,
    alternates: {
      canonical: `https://verifa.sk/slovnik/${term.slug}`,
    },
    openGraph: {
      title: `${term.title} — vysvetlenie | Verifa.sk`,
      description: term.shortDescription,
      type: "article",
    },
  };
}

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: "0 0 16px 0", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} style={{ fontSize: 22, fontWeight: 700, marginTop: 32, marginBottom: 12 }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("- **")) {
      const boldEnd = line.indexOf("**", 4);
      const boldText = line.slice(4, boldEnd);
      const restText = line.slice(boldEnd + 2);
      listItems.push(
        <li key={`li-${i}`} style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--text)" }}>{boldText}</strong>
          {restText}
        </li>
      );
    } else if (line.startsWith("- ")) {
      listItems.push(
        <li key={`li-${i}`} style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {line.slice(2)}
        </li>
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={j} style={{ color: "var(--text)" }}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });
      elements.push(
        <p key={`p-${i}`} style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
          {rendered}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

export default function GlossaryTermPage({ params }: { params: { slug: string } }) {
  const term = getGlossaryTerm(params.slug);
  if (!term) notFound();

  const related = glossaryTerms.filter((t) => t.slug !== term.slug).slice(0, 3);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "120px 24px 80px" }}>
        <Link
          href="/slovnik"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--text-muted)", textDecoration: "none", marginBottom: 24 }}
        >
          ← Slovník pojmov
        </Link>

        <span style={{ display: "inline-block", fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "var(--accent-light)", border: "1px solid var(--accent-border)", padding: "4px 12px", borderRadius: 999, marginBottom: 16 }}>
          {term.category}
        </span>

        <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>
          {term.title}
        </h1>

        <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 32 }}>
          {term.shortDescription}
        </p>

        <div style={{ marginBottom: 48 }}>
          {renderMarkdown(term.fullDescription)}
        </div>

        <div style={{ padding: "32px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, textAlign: "center", marginBottom: 48 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Overte firmu v reporte</h3>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Vygenerujte Business Risk Report a získajte {term.title} pre vašu cieľovú firmu.
          </p>
          <Link
            href="/register"
            style={{
              display: "inline-block",
              background: "var(--accent)",
              color: "var(--accent-button-text)",
              padding: "14px 32px",
              borderRadius: 12,
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            Začať overovať →
          </Link>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Súvisiace pojmy</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/slovnik/${r.slug}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 20px",
                  textDecoration: "none",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{r.title}</span>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
