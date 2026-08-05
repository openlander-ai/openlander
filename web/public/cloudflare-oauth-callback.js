(() => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const status = document.querySelector('#status');
  const returnLink = document.querySelector('#return-link');
  const callbackOrigin = window.location.origin;
  let notifyInterval;
  let notifyTimeout;

  const showReturnLink = () => {
    returnLink.hidden = false;
  };

  const stopNotifying = () => {
    window.clearInterval(notifyInterval);
    window.clearTimeout(notifyTimeout);
  };

  const notifyOpener = (payload) => {
    if (!window.opener || window.opener.closed) return false;
    const send = () => window.opener.postMessage(payload, callbackOrigin);
    send();
    notifyInterval = window.setInterval(send, 250);
    notifyTimeout = window.setTimeout(() => {
      stopNotifying();
      status.textContent = 'Authorization finished. Return to OpenLander to continue.';
      showReturnLink();
    }, 5000);
    return true;
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== callbackOrigin || event.source !== window.opener) return;
    if (event.data?.type !== 'openlander:cloudflare-oauth:ack') return;
    if (event.data.state !== state) return;
    stopNotifying();
    status.textContent = 'Authorization complete. You can close this window.';
    window.setTimeout(() => window.close(), 150);
  });

  const fail = (error, description) => {
    const payload = {
      type: 'openlander:cloudflare-oauth',
      state,
      error,
      error_description: description,
    };
    const handedOff = notifyOpener(payload);
    status.textContent = handedOff
      ? 'Authorization failed. Returning the error to OpenLander…'
      : `Authorization failed: ${description}`;
    showReturnLink();
  };

  const completeAuthorization = async () => {
    const providerError = params.get('error');
    if (providerError) {
      fail(
        providerError,
        params.get('error_description') || 'Cloudflare rejected the authorization request.',
      );
      return;
    }

    const code = params.get('code');
    if (!code || !state) {
      fail('MISSING_OAUTH_RESPONSE', 'Cloudflare returned an incomplete authorization response.');
      return;
    }

    status.textContent = 'Completing Cloudflare authorization…';
    try {
      const response = await fetch('/api/setup/cloudflare/oauth/complete', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, state }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || 'OpenLander could not complete authorization.');
      }

      const payload = {
        type: 'openlander:cloudflare-oauth',
        status: 'authorized',
        state,
        accounts: Array.isArray(result.accounts) ? result.accounts : [],
      };
      const handedOff = notifyOpener(payload);
      status.textContent = handedOff
        ? 'Authorization complete. Returning to OpenLander…'
        : 'Authorization complete. Return to OpenLander to continue.';
      if (!handedOff) showReturnLink();
    } catch (error) {
      fail(
        'OAUTH_COMPLETION_FAILED',
        error instanceof Error ? error.message : 'OpenLander could not complete authorization.',
      );
    }
  };

  void completeAuthorization();
  window.addEventListener('beforeunload', stopNotifying);
})();
