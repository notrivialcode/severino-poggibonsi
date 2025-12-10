export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Severino Poggibonsi</h1>
      <p>GitHub bot for NOTRIVIAL organization</p>
      <ul>
        <li>Manages stale pull requests</li>
        <li>Cleans up merged branches</li>
        <li>Notifies contributors via Slack</li>
      </ul>
      <p>
        <strong>Webhook endpoint:</strong> <code>/api/webhook</code>
      </p>
    </main>
  );
}