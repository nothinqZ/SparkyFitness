# Garmin's Connect IQ Mobile SDK is not redistributed with this repository
# (Garmin license). scripts/ios/fetch-connectiq-sdk.sh downloads the pinned
# ConnectIQ.xcframework into vendor/ before `pod install`; without it the
# module still builds and reports itself unavailable.
connectiq_sdk = File.join(__dir__, 'vendor', 'ConnectIQ.xcframework')

Pod::Spec.new do |s|
  s.name           = 'GarminConnectIQModule'
  s.version        = '1.0.0'
  s.summary        = 'Talks to the Sparky Strength Connect IQ watch app over Bluetooth.'
  s.author         = 'SparkyFitness'
  s.homepage       = 'https://github.com/CodeWithCJ/SparkyFitness'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.license        = 'MIT'

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,m,mm,swift}'
  # A dynamic framework: CocoaPods links and embeds it. Its classes are looked
  # up at runtime (GarminConnectIQModule.swift), so no header import is needed.
  s.vendored_frameworks = 'vendor/ConnectIQ.xcframework' if File.exist?(connectiq_sdk)
end
