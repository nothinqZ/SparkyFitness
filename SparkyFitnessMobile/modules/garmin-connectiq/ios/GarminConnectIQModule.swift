import ExpoModulesCore
import Foundation
import ObjectiveC

/// The Connect IQ SDK's `ConnectIQ` singleton, called through its exact
/// Objective-C selectors (from ConnectIQ.framework's ConnectIQ.h). Going
/// through this protocol instead of `import ConnectIQ` keeps the module
/// independent of how Swift would rename them, and lets it build without
/// the SDK, which is fetched at build time and may be absent.
@objc private protocol CIQSDK {
    @objc(initializeWithUrlScheme:uiOverrideDelegate:)
    func initialize(urlScheme: String, uiOverrideDelegate: AnyObject?)
    @objc(showConnectIQDeviceSelection)
    func showDeviceSelection()
    @objc(parseDeviceSelectionResponseFromURL:)
    func parseDeviceSelectionResponse(url: URL) -> [AnyObject]?
    @objc(registerForDeviceEvents:delegate:)
    func registerDeviceEvents(device: AnyObject, delegate: AnyObject)
    @objc(unregisterForAllDeviceEvents:)
    func unregisterAllDeviceEvents(delegate: AnyObject)
    @objc(getDeviceStatus:)
    func deviceStatus(device: AnyObject) -> Int
    @objc(registerForAppMessages:delegate:)
    func registerAppMessages(app: AnyObject, delegate: AnyObject)
    @objc(unregisterForAllAppMessages:)
    func unregisterAllAppMessages(delegate: AnyObject)
    @objc(sendMessage:toApp:progress:completion:)
    func sendMessage(
        _ message: Any,
        toApp app: AnyObject,
        progress: ((UInt32, UInt32) -> Void)?,
        completion: ((Int) -> Void)?
    )
}

/// IQDeviceStatus (ConnectIQ.h), in declaration order.
private let deviceStatusNames = [
    "invalidDevice", "bluetoothNotReady", "notFound", "notConnected", "connected",
]

/// IQDeviceStatus_Connected.
private let statusConnected = 4
/// IQSendMessageResult_Success.
private let sendSuccess = 0

/// Receives the SDK's delegate callbacks. The selectors are spelled out so
/// they match IQDeviceEventDelegate, IQAppMessageDelegate and
/// IQUIOverrideDelegate exactly; the protocols themselves are attached at
/// runtime in `init` because their Swift declarations are not imported.
private final class CIQDelegateHandler: NSObject {
    var onStatus: ((AnyObject, Int) -> Void)?
    var onMessage: ((Any, AnyObject) -> Void)?

    override init() {
        super.init()
        for name in ["IQDeviceEventDelegate", "IQAppMessageDelegate", "IQUIOverrideDelegate"] {
            if let proto = objc_getProtocol(name) {
                class_addProtocol(CIQDelegateHandler.self, proto)
            }
        }
    }

    @objc(deviceStatusChanged:status:)
    func deviceStatusChanged(_ device: AnyObject, status: Int) {
        onStatus?(device, status)
    }

    @objc(deviceCharacteristicsDiscovered:)
    func deviceCharacteristicsDiscovered(_ device: AnyObject) {}

    @objc(receivedMessage:fromApp:)
    func receivedMessage(_ message: Any, fromApp app: AnyObject) {
        onMessage?(message, app)
    }

    /// Garmin Connect is not installed. The SDK has nothing to talk to, and
    /// the JS side reports that when no device can be selected.
    @objc(needsToInstallConnectMobile)
    func needsToInstallConnectMobile() {}
}

/// Bridges the Connect IQ Mobile SDK to the Sparky Strength watch app: device
/// selection through Garmin Connect, device status, and app messages in both
/// directions over Bluetooth (no internet needed once a device is selected).
public class GarminConnectIQModule: Module {
    /// Manifest id of SparkyFitnessConnectIQ (manifest.xml), as a UUID.
    private static let watchAppId = UUID(uuidString: "a73dfc42-6574-48d4-befb-d4312730dcdc")!
    /// The app's Connect IQ Store listing (beta), used only for store links.
    private static let watchStoreId = UUID(uuidString: "72557e98-0839-42e3-925f-3f97907e6a12")!
    private static let devicesKey = "GarminConnectIQ.devices"

    private let handler = CIQDelegateHandler()
    private var sdk: CIQSDK?
    private var devices: [AnyObject] = []
    /// One IQApp per device, keyed by the device's uuid string.
    private var apps: [String: AnyObject] = [:]

    public func definition() -> ModuleDefinition {
        Name("GarminConnectIQ")

        Events("onMessage", "onDeviceStatus")

        OnCreate {
            self.handler.onStatus = { [weak self] device, status in
                guard let self else { return }
                self.sendEvent("onDeviceStatus", [
                    "deviceId": Self.deviceId(device) ?? "",
                    "status": Self.statusName(status),
                ])
            }
            self.handler.onMessage = { [weak self] message, app in
                guard let self else { return }
                let device = (app as? NSObject)?.value(forKey: "device") as AnyObject?
                self.sendEvent("onMessage", [
                    "deviceId": device.flatMap { Self.deviceId($0) } ?? "",
                    "message": message,
                ])
            }
        }

        Function("isAvailable") { () -> Bool in
            NSClassFromString("ConnectIQ") != nil
        }

        /// Starts the SDK with the URL scheme Garmin Connect returns to after
        /// device selection, and reconnects to devices selected earlier.
        AsyncFunction("initialize") { (urlScheme: String) -> Bool in
            guard let sdk = self.connectIQ() else { return false }
            if self.sdk == nil {
                sdk.initialize(urlScheme: urlScheme, uiOverrideDelegate: self.handler)
                self.sdk = sdk
                self.adopt(devices: Self.loadDevices())
            }
            return true
        }
        .runOnQueue(.main)

        /// Opens Garmin Connect to pick the watch. Garmin Connect returns
        /// through the URL scheme; pass that URL to `handleUrl`.
        AsyncFunction("showDeviceSelection") { () -> Bool in
            guard let sdk = self.sdk else { return false }
            sdk.showDeviceSelection()
            return true
        }
        .runOnQueue(.main)

        AsyncFunction("handleUrl") { (urlString: String) -> [[String: Any]] in
            guard let sdk = self.sdk, let url = URL(string: urlString),
                  let selected = sdk.parseDeviceSelectionResponse(url: url)
            else {
                return self.describeDevices()
            }
            self.adopt(devices: selected)
            Self.saveDevices(selected)
            return self.describeDevices()
        }
        .runOnQueue(.main)

        AsyncFunction("getDevices") { () -> [[String: Any]] in
            self.describeDevices()
        }
        .runOnQueue(.main)

        AsyncFunction("forgetDevices") { () in
            if let sdk = self.sdk {
                sdk.unregisterAllAppMessages(delegate: self.handler)
                sdk.unregisterAllDeviceEvents(delegate: self.handler)
            }
            self.devices = []
            self.apps = [:]
            UserDefaults.standard.removeObject(forKey: Self.devicesKey)
        }
        .runOnQueue(.main)

        /// Sends one message to the watch app on every connected device.
        /// Resolves with the number of devices that accepted it.
        AsyncFunction("sendMessage") { (message: [String: Any], promise: Promise) in
            guard let sdk = self.sdk else {
                promise.resolve(0)
                return
            }
            let targets = self.devices.filter {
                sdk.deviceStatus(device: $0) == statusConnected
            }
            guard !targets.isEmpty else {
                promise.resolve(0)
                return
            }
            var pending = targets.count
            var delivered = 0
            for device in targets {
                guard let id = Self.deviceId(device), let app = self.apps[id] else {
                    pending -= 1
                    continue
                }
                sdk.sendMessage(message as NSDictionary, toApp: app, progress: nil) { result in
                    if result == sendSuccess { delivered += 1 }
                    pending -= 1
                    if pending == 0 { promise.resolve(delivered) }
                }
            }
            if pending == 0 { promise.resolve(delivered) }
        }
        .runOnQueue(.main)
    }

    // MARK: - SDK access

    private func connectIQ() -> CIQSDK? {
        guard let cls = NSClassFromString("ConnectIQ") as? NSObject.Type,
              let shared = cls.perform(NSSelectorFromString("sharedInstance"))?
                .takeUnretainedValue()
        else { return nil }
        return unsafeBitCast(shared, to: CIQSDK.self)
    }

    /// `+[IQApp appWithUUID:storeUuid:device:]`, called through its
    /// implementation pointer for the same reason as `CIQSDK`.
    private func makeApp(for device: AnyObject) -> AnyObject? {
        guard let cls = NSClassFromString("IQApp") else { return nil }
        let selector = NSSelectorFromString("appWithUUID:storeUuid:device:")
        guard let method = class_getClassMethod(cls, selector) else { return nil }
        typealias Factory = @convention(c) (AnyClass, Selector, NSUUID, NSUUID, AnyObject) -> AnyObject?
        let factory = unsafeBitCast(method_getImplementation(method), to: Factory.self)
        return factory(cls, selector, Self.watchAppId as NSUUID, Self.watchStoreId as NSUUID, device)
    }

    /// Registers for status and app messages of each device and keeps them.
    private func adopt(devices newDevices: [AnyObject]) {
        guard let sdk = sdk else { return }
        sdk.unregisterAllAppMessages(delegate: handler)
        sdk.unregisterAllDeviceEvents(delegate: handler)
        devices = newDevices
        apps = [:]
        for device in newDevices {
            guard let id = Self.deviceId(device) else { continue }
            sdk.registerDeviceEvents(device: device, delegate: handler)
            if let app = makeApp(for: device) {
                apps[id] = app
                sdk.registerAppMessages(app: app, delegate: handler)
            }
        }
    }

    private func describeDevices() -> [[String: Any]] {
        devices.map { device in
            let object = device as? NSObject
            return [
                "id": Self.deviceId(device) ?? "",
                "name": (object?.value(forKey: "friendlyName") as? String) ?? "",
                "model": (object?.value(forKey: "modelName") as? String) ?? "",
                "status": Self.statusName(sdk?.deviceStatus(device: device) ?? 0),
            ]
        }
    }

    // MARK: - Helpers

    private static func deviceId(_ device: AnyObject) -> String? {
        ((device as? NSObject)?.value(forKey: "uuid") as? NSUUID)?.uuidString
    }

    private static func statusName(_ status: Int) -> String {
        status >= 0 && status < deviceStatusNames.count ? deviceStatusNames[status] : "unknown"
    }

    /// The SDK asks companion apps to cache selected devices; IQDevice
    /// supports NSSecureCoding.
    private static func saveDevices(_ devices: [AnyObject]) {
        guard let data = try? NSKeyedArchiver.archivedData(
            withRootObject: devices, requiringSecureCoding: false
        ) else { return }
        UserDefaults.standard.set(data, forKey: devicesKey)
    }

    private static func loadDevices() -> [AnyObject] {
        guard let data = UserDefaults.standard.data(forKey: devicesKey),
              let unarchiver = try? NSKeyedUnarchiver(forReadingFrom: data)
        else { return [] }
        unarchiver.requiresSecureCoding = false
        let decoded = unarchiver.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
        unarchiver.finishDecoding()
        return (decoded as? [AnyObject]) ?? []
    }
}
