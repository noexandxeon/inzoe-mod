// Catches identifiers that are read but never declared (the cause of the 0.5.1 outing failure).
// Run with: npx --yes eslint@9 ZoiObserver_XDX478/ui/HouseholdObserver
const readonly = names => Object.fromEntries(names.map(name => [name, 'readonly']));
export default [{
  files: ['ZoiObserver_XDX478/ui/HouseholdObserver/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      ...readonly(['window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'sessionStorage', 'localStorage', 'requestAnimationFrame', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
        'inzoi', 'engine', 'wf',
        'ObserverLife', 'ObserverPolicy', 'ObserverGoalMemory', 'ObserverChoices', 'ObserverAgenda', 'ObserverRecovery',
        'ObserverRelations', 'ObserverGameData', 'ObserverChildCare', 'ObserverProtocol', 'ObserverTravel',
        'ObserverPanels', 'ObserverLifeActions', 'ObserverScoreboard', 'ObserverGathering']),
      module: 'writable',
    },
  },
  rules: {'no-undef': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-const-assign': 'error'},
}];
