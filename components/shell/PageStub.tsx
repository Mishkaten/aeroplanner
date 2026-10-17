export function PageStub({ title, text }: { title: string; text: string }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
