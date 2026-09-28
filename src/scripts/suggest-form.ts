export function bindSuggestForm(): void {
  const form = document.getElementById("suggest-form") as HTMLFormElement | null;
  if (!form) return;
  const select = form.elements.namedItem("project") as HTMLSelectElement;
  const subject = form.elements.namedItem("_subject") as HTMLInputElement;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = form.querySelector<HTMLElement>(".form-status")!;

  const preselect = new URLSearchParams(window.location.search).get("project");
  if (preselect && [...select.options].some((o) => o.value === preselect)) select.value = preselect;

  const show = (message: string, state: "pending" | "success" | "error") => {
    status.hidden = false;
    status.textContent = message;
    status.dataset.state = state;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    subject.value = `Chicago Pipeline suggestion: ${select.selectedOptions[0]?.text ?? "New project"}`;
    button.disabled = true;
    show("Sending…", "pending");
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Formspree responded ${res.status}`);
      form.reset();
      show("Thanks — we review every suggestion before anything is published.", "success");
    } catch {
      show("Sorry, that didn't send. Please try again, or call (312) 296-4855.", "error");
    } finally {
      button.disabled = false;
    }
  });
}
