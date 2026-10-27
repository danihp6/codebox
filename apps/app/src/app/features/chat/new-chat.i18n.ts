import type { Locale } from '../../core/i18n/i18n.service';

/** One dictionary for the panel and the picker: `features/repos` owns the component, not the copy. */
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'newChat.proposal.repository': 'Connect a repository',
    'newChat.proposal.repository.hint': 'Work on the code and open a pull request.',
    'newChat.proposal.schedule': 'Schedule something',
    'newChat.proposal.schedule.hint': 'Describe it in the chat and it becomes a routine.',
    'newChat.composer.label': 'Message',
    'newChat.composer.placeholder': 'Ask anything…',
    'newChat.composer.send': 'Send',
    'newChat.composer.converting': 'Connecting a repository…',
    'newChat.picker.title': 'Connect a repository',
    'newChat.picker.loading': 'Loading repositories…',
    'newChat.picker.empty': 'No repositories yet.',
    'newChat.picker.unavailable': 'The repositories could not be loaded.',
    'newChat.picker.retry': 'Retry',
    'newChat.error.hint': 'Nothing was sent. The draft is kept.',
    'repoPicker.aria': 'Repositories',
    'repoPicker.state.connected': 'Connected',
    'repoPicker.state.cloning': 'Cloning…',
    'repoPicker.state.unavailable': 'Unavailable',
  }),
  es: Object.freeze({
    'newChat.proposal.repository': 'Conectar un repositorio',
    'newChat.proposal.repository.hint': 'Trabaja sobre el código y abre una pull request.',
    'newChat.proposal.schedule': 'Programar algo',
    'newChat.proposal.schedule.hint': 'Descríbelo en el chat y se convierte en una rutina.',
    'newChat.composer.label': 'Mensaje',
    'newChat.composer.placeholder': 'Pregunta lo que quieras…',
    'newChat.composer.send': 'Enviar',
    'newChat.composer.converting': 'Conectando un repositorio…',
    'newChat.picker.title': 'Conectar un repositorio',
    'newChat.picker.loading': 'Cargando repositorios…',
    'newChat.picker.empty': 'Todavía no hay repositorios.',
    'newChat.picker.unavailable': 'No se han podido cargar los repositorios.',
    'newChat.picker.retry': 'Reintentar',
    'newChat.error.hint': 'No se envió nada. El borrador se conserva.',
    'repoPicker.aria': 'Repositorios',
    'repoPicker.state.connected': 'Conectado',
    'repoPicker.state.cloning': 'Clonando…',
    'repoPicker.state.unavailable': 'No disponible',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
