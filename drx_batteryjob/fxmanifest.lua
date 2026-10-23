fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'drx_batteryjob'
description 'Roadside battery assistance job - external DUI screen, real jumper cables, tablet app'
version '1.0.0'

ox_lib 'locale'

shared_scripts {
    '@ox_lib/init.lua',
    '@qbx_core/modules/lib.lua',
    'config.lua',
}

client_scripts {
    'client/cl_utils.lua',
    'client/cl_dialog.lua',
    'client/cl_screen.lua',
    'client/cl_cables.lua',
    'client/cl_job.lua',
    'client/cl_dev.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server/sv_main.lua',
}

ui_page 'web/dialog/index.html'

files {
    'locales/*.json',
    'web/dialog/index.html',
    'web/screen/index.html',
    'web/app/index.html',
}

dependencies {
    'qbx_core',
    'ox_lib',
    'ox_target',
    'oxmysql',
}
