export default function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600 dark:border-zinc-700 dark:border-t-blue-400"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
