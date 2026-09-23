import py_compile
try:
    py_compile.compile(r'G:\code\paopaotang\game.js', doraise=True)
    print('game.js: OK')
except py_compile.PyCompileError as e:
    print(f'game.js: ERROR - {e}')
try:
    py_compile.compile(r'G:\code\paopaotang\asset-loader.js', doraise=True)
    print('asset-loader.js: OK')
except py_compile.PyCompileError as e:
    print(f'asset-loader.js: ERROR - {e}')
