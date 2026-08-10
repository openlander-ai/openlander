(() => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const status = document.querySelector('#status');
  const returnButton = document.querySelector('#return-button');
  let notifyInterval;
  let notifyTimeout;

  const showReturnButton = () => {
    returnButton.hidden = false;
  };

  const stopNotifying = () => {
    window.clearInterval(notifyInterval);
    window.clearTimeout(notifyTimeout);
  };

  const notifyOpener = (payload) => {
    if (!window.opener || window.opener.closed) return false;
    // The publisher callback is intentionally cross-origin from self-hosted
    // OpenLander instances. The opener accepts this message only from the
    // exact popup window, configured callback origin, and matching OAuth state.
    const send = () => window.opener.postMessage(payload, '*');
    send();
    notifyInterval = window.setInterval(send, 250);
    notifyTimeout = window.setTimeout(() => {
      stopNotifying();
      status.textContent = 'Authorization finished. Return to OpenLander to continue.';
      showReturnButton();
    }, 5000);
    return true;
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.opener) return;
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
    showReturnButton();
  };

  const completeAuthorization = () => {
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

    const payload = {
      type: 'openlander:cloudflare-oauth',
      status: 'authorized',
      code,
      state,
    };
    const handedOff = notifyOpener(payload);
    status.textContent = handedOff
      ? 'Authorization complete. Returning to OpenLander…'
      : 'Authorization complete. Return to OpenLander to continue.';
    if (!handedOff) showReturnButton();
  };

  returnButton.addEventListener('click', () => {
    if (window.opener && !window.opener.closed) window.opener.focus();
    window.close();
  });

  window.history.replaceState(null, '', window.location.pathname);
  completeAuthorization();
  window.addEventListener('beforeunload', stopNotifying);
})();
