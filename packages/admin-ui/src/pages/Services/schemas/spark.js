import * as Yup from 'yup'

import { TextInput, Autocomplete } from '../../../components/inputs/formik'

export default {
  code: 'spark',
  name: 'Spark',
  title: 'Spark (Wallet)',
  elements: [
    {
      code: 'sparkNetwork',
      display: 'Network',
      component: Autocomplete,
      inputProps: {
        options: [
          { code: 'MAINNET', display: 'mainnet' },
          { code: 'TESTNET', display: 'testnet' },
        ],
        labelProp: 'display',
        valueProp: 'code',
      },
      face: true,
    },
    {
      code: 'usdbTokenIdentifier',
      display: 'USDB token identifier',
      component: TextInput,
    },
    {
      code: 'sparkSdkPath',
      display: 'Spark SDK import path',
      component: TextInput,
    },
  ],
  getValidationSchema: () => {
    return Yup.object().shape({
      sparkNetwork: Yup.string('The network must be a string')
        .matches(/(MAINNET|TESTNET)/)
        .required('The network is required'),
      usdbTokenIdentifier: Yup.string(
        'The USDB token identifier must be a string',
      ).max(120, 'The USDB token identifier is too long'),
      sparkSdkPath: Yup.string('The Spark SDK import path must be a string').max(
        200,
        'The Spark SDK import path is too long',
      ),
    })
  },
}
