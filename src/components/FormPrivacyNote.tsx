import Link from "next/link";

/**
 * Notice at the point of collection — required by GDPR Art. 13 and the CCPA
 * notice-at-collection rule. Render under every public form that submits
 * personal data; `what` names the fields that form actually stores.
 */
export default function FormPrivacyNote({ what }: { what: string }) {
  return (
    <p
      style={{
        fontSize: "0.78rem",
        lineHeight: 1.6,
        color: "var(--text-muted)",
        fontFamily: "var(--body-font)",
        margin: 0,
        maxWidth: "60ch",
      }}
    >
      We store {what} to handle this request. We don&apos;t record your IP
      address and we never sell your information —{" "}
      <Link href="/privacy" style={{ color: "var(--accent-primary)" }}>
        Privacy Notice
      </Link>
      .
    </p>
  );
}
