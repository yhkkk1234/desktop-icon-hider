{
  "targets": [
    {
      "target_name": "icon_extractor",
      "sources": [ "src/native/icon_extractor.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "configurations": {
        "Debug": {
          "msvs_windows_target_platform_version": "10.0.16299.0"
        },
        "Release": {
          "msvs_windows_target_platform_version": "10.0.16299.0"
        }
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/std:c++17" ]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-lshell32.lib",
            "-lgdi32.lib",
            "-lgdiplus.lib"
          ],
          "defines": [
            "NOMINMAX",
            "UNICODE",
            "_UNICODE"
          ]
        }]
      ]
    }
  ]
}
