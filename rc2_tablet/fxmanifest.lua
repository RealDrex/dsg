fx_version 'cerulean'
game 'gta5'
lua54 'yes'
name 'rc2_tablet'
author 'Jaber Eyad'
description 'RC2 Tablet - app launcher (apps are separate resources)'
version '1.1.0'

ox_lib 'locale'

shared_scripts {
    '@ox_lib/init.lua',
    '@qbx_core/modules/lib.lua',
    'config.lua',
}

client_scripts {
    '@qbx_core/modules/playerdata.lua',
    'client/*.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server/*.lua',
}

ui_page 'web/build/index.html'

files {
    'web/build/**',
    'locales/*.json',
}

dependencies {
    'ox_lib',
    'qbx_core',
}
