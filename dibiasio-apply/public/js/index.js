(function () {
  const params = new URLSearchParams(location.search);
  const agentId = params.get('a');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  document.getElementById('choices').innerHTML = Object.values(DR.FORMS).map((form) => `
    <div class="choice">
      <h2>${esc(form.title)}</h2>
      <div class="meta">About ${form.minutes} minutes${form.separateAdults ? ' · one per adult' : ' · whole household'}</div>
      <p>${esc(form.blurb)}</p>
      <a class="btn block" href="/apply?f=${form.id}${agentId ? '&a=' + encodeURIComponent(agentId) : ''}">Start ${esc(form.short)} application</a>
      ${(form.languages || []).includes('pt') ? `<a class="btn secondary block" style="margin-top:8px" lang="pt-BR" href="/apply?f=${form.id}&lang=pt${agentId ? '&a=' + encodeURIComponent(agentId) : ''}">Preencher em português</a>` : ''}
    </div>`).join('');

  if (agentId) {
    fetch('/api/public/agent/' + encodeURIComponent(agentId)).then((r) => (r.ok ? r.json() : null)).then((agent) => {
      if (!agent) return;
      const el = document.getElementById('agent-note');
      el.textContent = 'You\'re applying with ' + agent.name + '. They\'ll be notified as soon as you submit.';
      el.classList.remove('hidden');
    });
  }
})();
