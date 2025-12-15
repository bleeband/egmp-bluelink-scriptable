import { OK } from './input/confirm'
import PersistedLog from './io/PersistedLog'

export const alertAndLogError = (error: any, context: string) => {
  OK(`Erreur sur ${context} (voir log)`, { message: String(error) })
  PersistedLog().log({ type: 'Erreur', error: JSON.stringify(error) })
}
