"""Build the install ZIP with the standard library; never include saved reports."""
import html
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
MOD = ROOT / 'ZoiObserver_XDX478'


def main():
    version = json.loads((MOD / 'ZoiObserver_XDX478.uplugin').read_text())['VersionName']
    manual = (ROOT / '사용설명서.md').read_bytes()
    files = {p.relative_to(ROOT).as_posix(): p.read_bytes()
             for p in sorted(MOD.rglob('*'))
             if p.is_file() and not p.is_symlink()
             and 'saved' not in p.relative_to(MOD).parts and p.suffix != '.cfg'}
    files['사용설명서.md'] = manual
    files['사용설명서.html'] = (
        '<!doctype html><html lang="ko"><meta charset="utf-8">'
        f'<title>Zoi Observer {version} 사용설명서</title>'
        '<style>body{max-width:960px;margin:32px auto;padding:16px;font-family:sans-serif;'
        'line-height:1.7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style>'
        '<pre>' + html.escape(manual.decode('utf-8')) + '</pre></html>'
    ).encode('utf-8')
    files['먼저읽기.txt'] = (
        f'Zoi Observer {version} 실험판\n'
        '게임을 종료하고 기존 모드 폴더 전체를 별도로 백업하세요.\n'
        'ZIP의 ZoiObserver_XDX478 폴더를 문서/inZOI/Mods/InGame 안에 복사하세요.\n'
        '기존 saved 폴더는 보존하세요. 자세한 적용 방법과 검증 범위는 사용설명서를 확인하세요.\n'
    ).encode('utf-8')
    output = ROOT / 'downloads' / f'ZoiObserver-v{version}.zip'
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name, contents in sorted(files.items()):
            entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, contents)
    print(f'{output.name}: {len(files)} files, {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
