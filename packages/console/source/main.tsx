import { RouterProvider } from '@tanstack/react-router'
import { mountShell } from './shell/providers'
import { router } from './routing/router'

mountShell('root', <RouterProvider router={router} />)
