(() => {
  'use strict';

  const key = 'scrappy_kin_analytics_choice';
  const legacyIgnoreKey = 'scrappy_kin_analytics_ignore';
  const blockedPath = /^\/(?:ghost(?:\/|$)|privacy(?:[./]|$)|help\/privacy(?:[/-]|$))/;
  let sentThisLoad = false;

  function choice() {
    try {
      const value = localStorage.getItem(key);
      if (value === 'accepted' || value === 'declined') return value;
      // Existing exclusions remain exclusions after the consent-first migration.
      if (localStorage.getItem(legacyIgnoreKey) === 'true') return 'declined';
      return 'unset';
    } catch (_) {
      return 'unavailable';
    }
  }

  function signalsBlocked() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  }

  function countThisLoad() {
    if (sentThisLoad || choice() !== 'accepted' || signalsBlocked() || blockedPath.test(location.pathname)) return;
    sentThisLoad = true;
    const body = JSON.stringify({ path: location.pathname });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/_analytics/event', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/_analytics/event', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true });
    }
  }

  function setChoice(value) {
    try {
      localStorage.setItem(key, value);
      localStorage.removeItem(legacyIgnoreKey);
      if (localStorage.getItem(key) !== value) return false;
    } catch (_) {
      return false;
    }
    if (value === 'accepted') countThisLoad();
    return true;
  }

  function copy(siteName) {
    return {
      heading: `May we count your anonymous page visits to ${siteName}?`,
      purpose: 'This helps us understand whether our work is being used.',
      countedHeading: 'What we count',
      counted: ['Anonymous daily page visits', 'One count each time a page loads'],
      notCountedHeading: "What we don’t collect",
      notCounted: [
        'What you read, click, or do on a page',
        'How long you stay',
        'Information that lets our analytics tell who you are, or which visits came from the same person'
      ],
      decline: "Don’t count my visits",
      accept: 'Count my visits',
      change: "You can change your choice using Privacy choices in this site's footer.",
      choices: 'Privacy choices',
      privacyPolicy: 'Privacy Policy',
      terms: 'Terms',
      acceptedStatus: 'Page visits are counted on this site.',
      declinedStatus: 'Page visits are not counted on this site.',
      unsetStatus: 'No choice saved. Page visits are not counted.',
      unavailableStatus: 'Your choice could not be saved. Page visits are not counted.',
      signalStatus: 'Your browser privacy signal keeps measurement off.'
    };
  }

  window.scrappyKinAnalytics = {
    choice,
    signalsBlocked,
    accept: () => setChoice('accepted'),
    decline: () => setChoice('declined'),
    copy
  };
  countThisLoad();
})();
