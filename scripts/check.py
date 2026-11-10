"""Read-only syntax, manifest, entry point, version and release archive checks."""
import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
MOD = ROOT / 'ZoiObserver_XDX478'
UI = MOD / 'ui/HouseholdObserver'


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('src'):
            self.sources.append(dict(attrs)['src'])


def main():
    for file in sorted(UI.glob('*.js')):
        subprocess.run(['node', '--check', str(file)], check=True)
    print('JavaScript syntax: PASS')
    for file in list(MOD.rglob('*.json')) + list(MOD.rglob('*.uplugin')):
        json.loads(file.read_text(encoding='utf-8-sig'))
    manifest = json.loads((MOD / 'mod_manifest.json').read_text(encoding='utf-8'))
    for name in manifest['NonAssets']:
        assert (MOD / name.lstrip('/')).is_file(), name
    parser = Scripts()
    parser.feed((UI / 'index.html').read_text(encoding='utf-8'))
    assert parser.sources[:3] == ['coui://inzoi/cohtml.js', 'coui://inzoi/mod/inzoi-sdk.js', 'window.js']
    assert parser.sources[-2:] == ['app.js', 'devprobe.js']
    local = [name for name in parser.sources if '://' not in name]
    assert len(local) == len(set(local)), 'Duplicate script include'
    for name in local:
        assert (UI / name).is_file(), name
        assert f'/ui/HouseholdObserver/{name}' in manifest['NonAssets'], name
    assert parser.sources.index('goal-memory.js') < parser.sources.index('life-actions.js')
    assert parser.sources.index('child-care.js') < parser.sources.index('app.js')
    assert parser.sources.index('game-data.js') < parser.sources.index('life-actions.js')
    version = json.loads((MOD / 'ZoiObserver_XDX478.uplugin').read_text(encoding='utf-8'))['VersionName']
    assert f"VERSION='{version}'" in (UI / 'app.js').read_text(encoding='utf-8')
    assert f'Zoi Observer {version}' in (UI / 'index.html').read_text(encoding='utf-8')
    assert f'Zoi Observer {version}' == manifest['FriendlyName']
    assert f'Zoi Observer {version}' in (ROOT / '사용설명서.md').read_text(encoding='utf-8')
    print('JSON, manifest, script order and version references: PASS')
    expected = {p.relative_to(ROOT).as_posix(): p.read_bytes()
                for p in MOD.rglob('*') if p.is_file() and 'saved' not in p.parts and p.suffix != '.cfg'}
    with ZipFile(ROOT / 'downloads' / f'ZoiObserver-v{version}.zip') as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(names) == len(set(names)), 'Duplicate ZIP entry'
        assert set(names) == set(expected) | {'사용설명서.md', '사용설명서.html', '먼저읽기.txt'}
        for name, data in expected.items():
            assert archive.read(name) == data, f'ZIP/source mismatch: {name}'
        assert archive.read('사용설명서.md') == (ROOT / '사용설명서.md').read_bytes()
    print(f'ZIP CRC, exact source match ({len(expected)} mod files), packaged manual: PASS')


if __name__ == '__main__':
    main()
