const { SEVERITY } = require('./enums')
const { skipCoverage } = require('../../helpers/coverage')
const { assertRevert } = require('../../helpers/assertThrow')
const { getEvents, getEvent, getEventArgument } = require('../../helpers/events')

const KillSwitch = artifacts.require('KillSwitch')
const IssuesRegistry = artifacts.require('IssuesRegistry')
const KillSwitchedApp = artifacts.require('KillSwitchedAppMock')
const KernelWithoutKillSwitchMock = artifacts.require('KernelWithoutKillSwitchMock')

const ACL = artifacts.require('ACL')
const Kernel = artifacts.require('Kernel')
const DAOFactory = artifacts.require('DAOFactory')
const EVMScriptRegistryFactory = artifacts.require('EVMScriptRegistryFactory')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('KillSwitch', ([_, root, owner, securityPartner, anyone]) => {
  let registryFactory, dao, acl, app
  let kernelBase, aclBase, appBase, killSwitchBase, issuesRegistryBase, daoFactory, oldKernelBase
  let CORE_NAMESPACE, KERNEL_APP_ID, APP_MANAGER_ROLE, SET_SEVERITY_ROLE, SET_DEFAULT_ISSUES_REGISTRY_ROLE, SET_ISSUES_REGISTRY_ROLE, SET_ALLOWED_INSTANCES_ROLE, SET_DENIED_BASE_IMPLS_ROLE, SET_HIGHEST_ALLOWED_SEVERITY_ROLE

  before('deploy base implementations', async () => {
    kernelBase = await Kernel.new(true) // petrify immediately
    aclBase = await ACL.new()
    registryFactory = await EVMScriptRegistryFactory.new()
    killSwitchBase = await KillSwitch.new()
    issuesRegistryBase = await IssuesRegistry.new()
    appBase = await KillSwitchedApp.new()
    oldKernelBase = await KernelWithoutKillSwitchMock.new()
    daoFactory = await DAOFactory.new(kernelBase.address, aclBase.address, killSwitchBase.address, registryFactory.address)
  })

  before('load constants and roles', async () => {
    CORE_NAMESPACE = await kernelBase.CORE_NAMESPACE()
    KERNEL_APP_ID = await kernelBase.KERNEL_APP_ID()
    APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
    SET_SEVERITY_ROLE = await issuesRegistryBase.SET_SEVERITY_ROLE()
    SET_DEFAULT_ISSUES_REGISTRY_ROLE = await killSwitchBase.SET_DEFAULT_ISSUES_REGISTRY_ROLE()
    SET_ISSUES_REGISTRY_ROLE = await killSwitchBase.SET_ISSUES_REGISTRY_ROLE()
    SET_ALLOWED_INSTANCES_ROLE = await killSwitchBase.SET_ALLOWED_INSTANCES_ROLE()
    SET_DENIED_BASE_IMPLS_ROLE = await killSwitchBase.SET_DENIED_BASE_IMPLS_ROLE()
    SET_HIGHEST_ALLOWED_SEVERITY_ROLE = await killSwitchBase.SET_HIGHEST_ALLOWED_SEVERITY_ROLE()
  })

  context('when the kernel version does not support kill-switch logic', async () => {
    beforeEach('deploy DAO with a kernel version not supporting kill-switch logic', async () => {
      const receipt = await daoFactory.newDAO(root)
      dao = Kernel.at(getEventArgument(receipt, 'DeployDAO', 'dao'))
      acl = ACL.at(await dao.acl())
      await acl.createPermission(root, dao.address, APP_MANAGER_ROLE, root, { from: root })

      // update the kernel to a mock version that doesn't supports kill-switch logic to mimic already deployed ones
      await dao.setApp(CORE_NAMESPACE, KERNEL_APP_ID, oldKernelBase.address, { from: root })
    })

    beforeEach('create kill switched app', async () => {
      const receipt = await dao.newAppInstance('0x1236', appBase.address, '0x', false, { from: root })
      app = KillSwitchedApp.at(getEventArgument(receipt, 'NewAppProxy', 'proxy'))
      await app.initialize(owner)
    })

    describe('integration', () => {
      context('when the function being called is not tagged', () => {
        it('executes the call', async () => {
          assert.equal(await app.read(), 42)
        })
      })

      context('when the function being called is tagged', () => {
        it('executes the call', async () => {
          await app.write(10, { from: owner })
          assert.equal(await app.read(), 10)
        })
      })
    })
  })

  context('when the kernel version does support kill-switch logic', async () => {
    context('when the kernel was not initialized with a kill-switch', async () => {
      beforeEach('deploy DAO without a kill switch', async () => {
        const receipt = await daoFactory.newDAO(root)
        dao = Kernel.at(getEventArgument(receipt, 'DeployDAO', 'dao'))
        acl = ACL.at(await dao.acl())
        await acl.createPermission(root, dao.address, APP_MANAGER_ROLE, root, { from: root })
      })

      beforeEach('create kill switched app', async () => {
        const receipt = await dao.newAppInstance('0x1236', appBase.address, '0x', false, { from: root })
        app = KillSwitchedApp.at(getEventArgument(receipt, 'NewAppProxy', 'proxy'))
        await app.initialize(owner)
      })

      describe('integration', () => {
        context('when the function being called is not tagged', () => {
          it('executes the call', async () => {
            assert.equal(await app.read(), 42)
          })
        })

        context('when the function being called is tagged', () => {
          it('executes the call', async () => {
            await app.write(10, { from: owner })
            assert.equal(await app.read(), 10)
          })
        })
      })
    })

    context('when the kernel was initialized with a kill-switch', async () => {
      let killSwitch, defaultIssuesRegistry, specificIssuesRegistry

      const SAMPLE_APP_ID = '0x1236000000000000000000000000000000000000000000000000000000000000'
      
      beforeEach('create issues registries', async () => {
        const daoReceipt = await daoFactory.newDAO(root)
        const issuesRegistryDAO = Kernel.at(getEventArgument(daoReceipt, 'DeployDAO', 'dao'))
        const issuesRegistryACL = ACL.at(await issuesRegistryDAO.acl())

        await issuesRegistryACL.createPermission(root, issuesRegistryDAO.address, APP_MANAGER_ROLE, root, { from: root })

        const defaultRegistryReceipt = await issuesRegistryDAO.newAppInstance('0x1234', issuesRegistryBase.address, '0x', false, { from: root })
        defaultIssuesRegistry = IssuesRegistry.at(getEventArgument(defaultRegistryReceipt, 'NewAppProxy', 'proxy'))
        await defaultIssuesRegistry.initialize()
        await issuesRegistryACL.createPermission(securityPartner, defaultIssuesRegistry.address, SET_SEVERITY_ROLE, root, { from: root })

        const specificRegistryReceipt = await issuesRegistryDAO.newAppInstance('0x1234', issuesRegistryBase.address, '0x', false, { from: root })
        specificIssuesRegistry = IssuesRegistry.at(getEventArgument(specificRegistryReceipt, 'NewAppProxy', 'proxy'))
        await specificIssuesRegistry.initialize()
        await issuesRegistryACL.createPermission(securityPartner, specificIssuesRegistry.address, SET_SEVERITY_ROLE, root, { from: root })
      })

      beforeEach('deploy DAO with a kill switch', async () => {
        const receipt = await daoFactory.newDAOWithKillSwitch(root, defaultIssuesRegistry.address)
        dao = Kernel.at(getEventArgument(receipt, 'DeployDAO', 'dao'))
        acl = ACL.at(await dao.acl())
        killSwitch = KillSwitch.at(await dao.killSwitch())
        await acl.createPermission(root, dao.address, APP_MANAGER_ROLE, root, { from: root })
        await acl.createPermission(owner, killSwitch.address, SET_DEFAULT_ISSUES_REGISTRY_ROLE, root, { from: root })
        await acl.createPermission(owner, killSwitch.address, SET_ISSUES_REGISTRY_ROLE, root, { from: root })
        await acl.createPermission(owner, killSwitch.address, SET_ALLOWED_INSTANCES_ROLE, root, { from: root })
        await acl.createPermission(owner, killSwitch.address, SET_DENIED_BASE_IMPLS_ROLE, root, { from: root })
        await acl.createPermission(owner, killSwitch.address, SET_HIGHEST_ALLOWED_SEVERITY_ROLE, root, { from: root })
      })

      beforeEach('create kill switched app', async () => {
        const receipt = await dao.newAppInstance(SAMPLE_APP_ID, appBase.address, '0x', false, { from: root })
        app = KillSwitchedApp.at(getEventArgument(receipt, 'NewAppProxy', 'proxy'))
        await app.initialize(owner)
      })

      describe('isInstanceAllowed', function () {
        context('when there was no instance allowed value set yet', function () {
          it('returns false', async () => {
            assert.isFalse(await killSwitch.isInstanceAllowed(app.address))
          })
        })

        context('when there was an allowed value already set', function () {
          context('when it is allowed', function () {
            beforeEach('allow instance', async () => {
              await killSwitch.setAllowedInstance(app.address, true, { from: owner })
            })

            it('returns true', async () => {
              assert(await killSwitch.isInstanceAllowed(app.address))
            })
          })

          context('when it is not allowed', function () {
            beforeEach('do not allow instance', async () => {
              await killSwitch.setAllowedInstance(app.address, false, { from: owner })
            })

            it('returns false', async () => {
              assert.isFalse(await killSwitch.isInstanceAllowed(app.address))
            })
          })
        })
      })

      describe('setAllowedInstance', function () {
        context('when the sender is authorized', function () {
          const from = owner

          context('when there was no instance allowed yet', function () {
            it('sets a new allowed value', async () => {
              await killSwitch.setAllowedInstance(app.address, true, { from })

              assert(await killSwitch.isInstanceAllowed(app.address))
            })

            it('emits an event', async () => {
              const receipt = await killSwitch.setAllowedInstance(app.address, true, { from })

              const events = getEvents(receipt, 'AllowedInstanceSet')
              assert.equal(events.length, 1, 'number of AllowedInstanceSet events does not match')

              const event = getEvent(receipt, 'AllowedInstanceSet').args
              assert.equal(event.allowed, true, 'allowed value does not match')
              assert.equal(event.instance, app.address, 'instance address does not match')
            })
          })

          context('when there was a instance already allowed', function () {
            beforeEach('allow instance', async () => {
              await killSwitch.setAllowedInstance(app.address, true, { from })
            })

            it('changes the allowed value', async () => {
              await killSwitch.setAllowedInstance(app.address, false, { from })

              assert.isFalse(await killSwitch.isInstanceAllowed(app.address))
            })
          })
        })

        context('when the sender is not authorized', function () {
          const from = anyone

          it('reverts', async () => {
            await assertRevert(killSwitch.setAllowedInstance(app.address, true, { from }))
          })
        })
      })

      describe('isBaseImplementationDenied', function () {
        context('when there was no denied value set yet', function () {
          it('returns false', async () => {
            assert.isFalse(await killSwitch.isBaseImplementationDenied(appBase.address))
          })
        })

        context('when there was a denied value already set', function () {
          context('when it is denied', function () {
            beforeEach('deny base implementation', async () => {
              await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
            })

            it('returns true', async () => {
              assert.isTrue(await killSwitch.isBaseImplementationDenied(appBase.address))
            })
          })

          context('when it is not denied', function () {
            beforeEach('do not deny base implementation', async () => {
              await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
            })

            it('returns false', async () => {
              assert.isFalse(await killSwitch.isBaseImplementationDenied(appBase.address))
            })
          })
        })
      })

      describe('setDeniedBaseImplementation', function () {
        context('when the sender is authorized', function () {
          const from = owner

          context('when there was no base implementation denied yet', function () {
            it('sets a new denied value', async () => {
              await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from })

              assert(await killSwitch.isBaseImplementationDenied(appBase.address))
            })

            it('emits an event', async () => {
              const receipt = await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from })

              const events = getEvents(receipt, 'DeniedBaseImplementationSet')
              assert.equal(events.length, 1, 'number of DeniedBaseImplementationSet events does not match')

              const event = getEvent(receipt, 'DeniedBaseImplementationSet').args
              assert.equal(event.base, appBase.address, 'base address does not match')
              assert.equal(event.denied, true, 'denied value does not match')
            })
          })

          context('when there was a base implementation already denied', function () {
            beforeEach('deny base implementation', async () => {
              await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from })
            })

            it('changes the denied value', async () => {
              await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from })

              assert.isFalse(await killSwitch.isBaseImplementationDenied(appBase.address))
            })
          })
        })

        context('when the sender is not authorized', function () {
          const from = anyone

          it('reverts', async () => {
            await assertRevert(killSwitch.setDeniedBaseImplementation(appBase.address, true, { from }), 'APP_AUTH_FAILED')
          })
        })
      })

      describe('getIssuesRegistry', function () {
        context('when there was no specific issues registry set', () => {
          it('returns the default registry', async () => {
            assert.equal(await killSwitch.getIssuesRegistry(SAMPLE_APP_ID), defaultIssuesRegistry.address)
          })
        })

        context('when there is a specific issues registry set', () => {
          beforeEach('set specific issues registry', async () => {
            await killSwitch.setIssuesRegistry(SAMPLE_APP_ID, specificIssuesRegistry.address, { from: owner })
          })

          it('returns the default registry', async () => {
            assert.equal(await killSwitch.getIssuesRegistry(SAMPLE_APP_ID), specificIssuesRegistry.address)
          })
        })
      })

      describe('setIssuesRegistry', function () {
        context('when the sender is authorized', function () {
          const from = owner

          context('when the given address is not a contract', () => {
            it('reverts', async () => {
              await assertRevert(killSwitch.setIssuesRegistry(SAMPLE_APP_ID, ZERO_ADDRESS, { from }))
            })
          })

          context('when the given address is a contract', () => {
            context('when there was no specific issues registry set yet', function () {
              it('sets the given implementation', async () => {
                await killSwitch.setIssuesRegistry(SAMPLE_APP_ID, specificIssuesRegistry.address, { from })

                assert.equal(await killSwitch.getIssuesRegistry(SAMPLE_APP_ID), specificIssuesRegistry.address)
              })

              it('emits an event', async () => {
                const receipt = await killSwitch.setIssuesRegistry(SAMPLE_APP_ID, specificIssuesRegistry.address, { from })

                const events = getEvents(receipt, 'IssuesRegistrySet')
                assert.equal(events.length, 1, 'number of IssuesRegistrySet events does not match')

                const event = getEvent(receipt, 'IssuesRegistrySet').args
                assert.equal(event.appId, SAMPLE_APP_ID, 'app id does not match')
                assert.equal(event.issuesRegistry, specificIssuesRegistry.address, 'issues registry address does not match')
              })
            })

            context('when there was a specific issues registry set', function () {
              beforeEach('set specific issues registry', async () => {
                await killSwitch.setIssuesRegistry(SAMPLE_APP_ID, specificIssuesRegistry.address, { from })
              })

              it('changes the issues registry', async () => {
                await killSwitch.setIssuesRegistry(SAMPLE_APP_ID, defaultIssuesRegistry.address, { from })

                assert.equal(await killSwitch.getIssuesRegistry(SAMPLE_APP_ID), defaultIssuesRegistry.address)
              })
            })
          })
        })

        context('when the sender is not authorized', function () {
          const from = anyone

          it('reverts', async () => {
            await assertRevert(killSwitch.setIssuesRegistry(SAMPLE_APP_ID, specificIssuesRegistry.address, { from }))
          })
        })
      })

      describe('setDefaultIssuesRegistry', function () {
        context('when the sender is authorized', function () {
          const from = owner

          context('when the given address is not a contract', () => {
            it('reverts', async () => {
              await assertRevert(killSwitch.setDefaultIssuesRegistry(ZERO_ADDRESS, { from }))
            })
          })

          context('when the given address is a contract', () => {
            context('when there was no specific issues registry set yet', function () {
              it('sets the given implementation', async () => {
                await killSwitch.setDefaultIssuesRegistry(specificIssuesRegistry.address, { from })

                assert.equal(await killSwitch.defaultIssuesRegistry(), specificIssuesRegistry.address)
              })

              it('emits an event', async () => {
                const receipt = await killSwitch.setDefaultIssuesRegistry(specificIssuesRegistry.address, { from })

                const events = getEvents(receipt, 'DefaultIssuesRegistrySet')
                assert.equal(events.length, 1, 'number of DefaultIssuesRegistrySet events does not match')

                const event = getEvent(receipt, 'DefaultIssuesRegistrySet').args
                assert.equal(event.issuesRegistry, specificIssuesRegistry.address, 'issues registry address does not match')
              })
            })

            context('when there was a specific issues registry set', function () {
              beforeEach('set specific issues registry', async () => {
                await killSwitch.setDefaultIssuesRegistry(specificIssuesRegistry.address, { from })
                assert.equal(await killSwitch.defaultIssuesRegistry(), specificIssuesRegistry.address)
              })

              it('changes the issues registry', async () => {
                await killSwitch.setDefaultIssuesRegistry(defaultIssuesRegistry.address, { from })

                assert.equal(await killSwitch.defaultIssuesRegistry(), defaultIssuesRegistry.address)
              })
            })
          })
        })

        context('when the sender is not authorized', function () {
          const from = anyone

          it('reverts', async () => {
            await assertRevert(killSwitch.setDefaultIssuesRegistry(specificIssuesRegistry.address, { from }))
          })
        })
      })

      describe('isSeverityIgnored', function () {
        context('when there is no bug registered', () => {
          context('when there is no highest allowed severity set for the contract being called', () => {
            it('returns true', async () => {
              assert.isTrue(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
            })
          })

          context('when there is a highest allowed severity set for the contract being called', () => {
            beforeEach('set highest allowed severity', async () => {
              await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
            })

            it('returns true', async () => {
              assert.isTrue(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
            })
          })
        })

        context('when there is a bug registered', () => {
          beforeEach('register a bug', async () => {
            await defaultIssuesRegistry.setSeverityFor(appBase.address, SEVERITY.MID, { from: securityPartner })
          })

          context('when there is no highest allowed severity set for the contract being called', () => {
            it('returns false', async () => {
              assert.isFalse(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
            })
          })

          context('when there is a highest allowed severity set for the contract being called', () => {
            context('when the highest allowed severity is under the reported bug severity', () => {
              beforeEach('set highest allowed severity', async () => {
                await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
              })

              it('returns false', async () => {
                assert.isFalse(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
              })
            })

            context('when the highest allowed severity is equal to the reported bug severity', () => {
              beforeEach('set highest allowed severity', async () => {
                await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from: owner })
              })

              it('returns true', async () => {
                assert.isTrue(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
              })
            })

            context('when the highest allowed severity is greater than the reported bug severity', () => {
              beforeEach('set highest allowed severity', async () => {
                await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.CRITICAL, { from: owner })
              })

              it('returns true', async () => {
                assert.isTrue(await killSwitch.isSeverityIgnored(SAMPLE_APP_ID, appBase.address))
              })
            })
          })
        })
      })

      describe('setHighestAllowedSeverity', function () {
        context('when the sender is authorized', function () {
          const from = owner

          context('when there was no severity set', function () {
            it('sets the highest allowed severity', async () => {
              await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.HIGH, { from })

              assert.equal(await killSwitch.getHighestAllowedSeverity(SAMPLE_APP_ID), SEVERITY.HIGH)
            })

            it('emits an event', async () => {
              const receipt = await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.HIGH, { from })

              const events = getEvents(receipt, 'HighestAllowedSeveritySet')
              assert.equal(events.length, 1, 'number of ContractActionSet events does not match')

              const event = getEvent(receipt, 'HighestAllowedSeveritySet').args
              assert.equal(event.appId, SAMPLE_APP_ID, 'app id does not match')
              assert.equal(event.severity, SEVERITY.HIGH, 'highest severity does not match')
            })
          })

          context('when there was a previous severity set', function () {
            beforeEach('set highest  allowed severity', async () => {
              await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from })
              assert.equal(await killSwitch.getHighestAllowedSeverity(SAMPLE_APP_ID), SEVERITY.LOW)
            })

            it('changes the highest allowed severity', async () => {
              await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from })

              assert.equal(await killSwitch.getHighestAllowedSeverity(SAMPLE_APP_ID), SEVERITY.MID)
            })
          })
        })

        context('when the sender is not authorized', function () {
          const from = anyone

          it('reverts', async () => {
            await assertRevert(killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from }))
          })
        })
      })

      describe('integration', () => {
        context('when the function being called is not tagged', () => {

          const itExecutesTheCallEvenIfDenied = () => {
            const itExecutesTheCall = () => {
              it('executes the call', async () => {
                assert.equal(await app.read(), 42)
              })
            }

            context('when the instance being called is allowed', () => {
              beforeEach('allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, true, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itExecutesTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itExecutesTheCall()
              })
            })

            context('when the instance being called is not marked as allowed', () => {
              beforeEach('dot not allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, false, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itExecutesTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itExecutesTheCall()
              })
            })
          }

          context('when there is no bug registered', () => {
            context('when there is no highest allowed severity set for the app being called', () => {
              itExecutesTheCallEvenIfDenied()
            })

            context('when there is a highest allowed severity set for the contract being called', () => {
              beforeEach('set highest allowed severity', async () => {
                await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
              })

              itExecutesTheCallEvenIfDenied()
            })
          })

          context('when there is a bug registered', () => {
            beforeEach('register a bug', async () => {
              await defaultIssuesRegistry.setSeverityFor(appBase.address, SEVERITY.MID, { from: securityPartner })
            })

            context('when there is no highest allowed severity set for the contract being called', () => {
              itExecutesTheCallEvenIfDenied()
            })

            context('when there is a highest allowed severity set for the contract being called', () => {
              context('when the highest allowed severity is under the reported bug severity', () => {
                beforeEach('set highest allowed severity bellow the one reported', async () => {
                  await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
                })

                itExecutesTheCallEvenIfDenied()
              })

              context('when the highest allowed severity is equal to the reported bug severity', () => {
                beforeEach('set highest allowed severity equal to the one reported', async () => {
                  await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from: owner })
                })

                itExecutesTheCallEvenIfDenied()
              })

              context('when the highest allowed severity is greater than the reported bug severity', () => {
                beforeEach('set highest allowed severity above the one reported', async () => {
                  await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.HIGH, { from: owner })
                })

                itExecutesTheCallEvenIfDenied()
              })
            })
          })
        })

        context('when the function being called is tagged', () => {
          const itExecutesTheCall = () => {
            it('executes the call', async () => {
              await app.write(10, { from: owner })
              assert.equal(await app.read(), 10)
            })
          }

          const itDoesNotExecuteTheCall = () => {
            it('does not execute the call', async () => {
              await assertRevert(app.write(10, { from: owner }), 'APP_CONTRACT_CALL_NOT_ALLOWED')
            })
          }

          const itExecutesTheCallOnlyWhenAllowed = () => {
            context('when the instance being called is allowed', () => {
              beforeEach('allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, true, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itExecutesTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itExecutesTheCall()
              })
            })

            context('when the instance being called is not marked as allowed', () => {
              beforeEach('dot not allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, false, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itDoesNotExecuteTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itDoesNotExecuteTheCall()
              })
            })
          }

          const itExecutesTheCallUnlessDisallowedAndDenied = () => {
            context('when the instance being called is allowed', () => {
              beforeEach('allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, true, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itExecutesTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itExecutesTheCall()
              })
            })

            context('when the instance being called is not marked as allowed', () => {
              beforeEach('dot not allow instance', async () => {
                await killSwitch.setAllowedInstance(app.address, false, { from: owner })
              })

              context('when the base implementation is not denied', () => {
                beforeEach('do not deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, false, { from: owner })
                })

                itExecutesTheCall()
              })

              context('when the base implementation is denied', () => {
                beforeEach('deny base implementation', async () => {
                  await killSwitch.setDeniedBaseImplementation(appBase.address, true, { from: owner })
                })

                itDoesNotExecuteTheCall()
              })
            })
          }

          context('when there is no bug registered', () => {
            context('when there is no highest allowed severity set for the contract being called', () => {
              itExecutesTheCallUnlessDisallowedAndDenied()
            })

            context('when there is a highest allowed severity set for the contract being called', () => {
              beforeEach('set highest allowed severity', async () => {
                await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
              })

              itExecutesTheCallUnlessDisallowedAndDenied()
            })
          })

          context('when there is a bug registered', () => {
            beforeEach('register a bug', async () => {
              await defaultIssuesRegistry.setSeverityFor(appBase.address, SEVERITY.MID, { from: securityPartner })
            })

            context('when the bug was not fixed yet', () => {
              context('when there is no highest allowed severity set for the contract being called', () => {
                itExecutesTheCallOnlyWhenAllowed()
              })

              context('when there is a highest allowed severity set for the contract being called', () => {
                context('when the highest allowed severity is under the reported bug severity', () => {
                  beforeEach('set highest allowed severity below the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
                  })

                  itExecutesTheCallOnlyWhenAllowed()
                })

                context('when the highest allowed severity is equal to the reported bug severity', () => {
                  beforeEach('set highest allowed severity equal to the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from: owner })
                  })

                  itExecutesTheCallUnlessDisallowedAndDenied()
                })

                context('when the highest allowed severity is greater than the reported bug severity', () => {
                  beforeEach('set highest allowed severity above the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.CRITICAL, { from: owner })
                  })

                  itExecutesTheCallUnlessDisallowedAndDenied()
                })
              })
            })

            context('when the bug was already fixed', () => {
              beforeEach('fix bug', async () => {
                await defaultIssuesRegistry.setSeverityFor(appBase.address, SEVERITY.NONE, { from: securityPartner })
              })

              context('when there is no highest allowed severity set for the contract being called', () => {
                itExecutesTheCallUnlessDisallowedAndDenied()
              })

              context('when there is a highest allowed severity set for the contract being called', () => {
                context('when the highest allowed severity is under the reported bug severity', () => {
                  beforeEach('set highest allowed severity below the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.LOW, { from: owner })
                  })

                  itExecutesTheCallUnlessDisallowedAndDenied()
                })

                context('when the highest allowed severity is equal to the reported bug severity', () => {
                  beforeEach('set highest allowed severity equal to the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from: owner })
                  })

                  itExecutesTheCallUnlessDisallowedAndDenied()
                })

                context('when the highest allowed severity is greater than the reported bug severity', () => {
                  beforeEach('set highest allowed severity above the one reported', async () => {
                    await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.CRITICAL, { from: owner })
                  })

                  itExecutesTheCallUnlessDisallowedAndDenied()
                })
              })
            })
          })
        })
      })

      describe('gas costs', () => {
        beforeEach('set an allowed severity issue', async () => {
          await killSwitch.setHighestAllowedSeverity(SAMPLE_APP_ID, SEVERITY.MID, { from: owner })
          await defaultIssuesRegistry.setSeverityFor(appBase.address, SEVERITY.LOW, { from: securityPartner })
        })

        it('kill switch should overload ~27k of gas to a function', skipCoverage(async () => {
          const { receipt: { cumulativeGasUsed: gasUsedWithKillSwitch } } = await app.write(10, { from: owner })
          const { receipt: { cumulativeGasUsed: gasUsedWithoutKillSwitch } } = await app.writeWithoutKillSwitch(10, { from: owner })

          const killSwitchCost = gasUsedWithKillSwitch - gasUsedWithoutKillSwitch
          assert(killSwitchCost <= 27000, 'kill switch should overload ~27k of gas')
        }))
      })
    })
  })
})